<?php
/** Minimal persistent order storage and sandbox NVP transport. */
$db = new PDO('sqlite:'.(getenv('SHOP_DB') ?: '/tmp/legacy-orders.sqlite'));
$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
$db->exec('CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,amount TEXT,status TEXT); CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,payload TEXT)');
function products() { return [['id'=>'SD-001','name'=>'Horizon ceramic cup','price'=>'24.00'],['id'=>'SD-002','name'=>'Dune linen tote','price'=>'32.00'],['id'=>'SD-003','name'=>'Ember desk lamp','price'=>'89.00']]; }
function cartCount() { return array_sum(is_array($_SESSION['cart'] ?? null) ? $_SESSION['cart'] : []); }
function amount() { $cents=0; $cart=is_array($_SESSION['cart'] ?? null) ? $_SESSION['cart'] : []; foreach(products() as $p) $cents+=(int)round((float)$p['price']*100)*(int)($cart[$p['id']] ?? 0); return number_format($cents/100,2,'.',''); }
function base() { return getenv('SHOP_BASE_URL') ?: 'http://localhost:8080/'; }
function nvp($method,$params) {
 if(getenv('PAYPAL_MODE')!=='live')return ['ACK'=>'Success','TOKEN'=>'REPLAY-TOKEN','PAYMENTINFO_0_TRANSACTIONID'=>'REPLAY-'.($_SESSION['checkout_id'] ?? session_id())];
 foreach(['PAYPAL_NVP_USER','PAYPAL_NVP_PWD','PAYPAL_NVP_SIGNATURE'] as $key) if(!getenv($key)) throw new RuntimeException('Missing sandbox configuration');
 $body=http_build_query(array_merge(['METHOD'=>$method,'VERSION'=>'204','USER'=>getenv('PAYPAL_NVP_USER'),'PWD'=>getenv('PAYPAL_NVP_PWD'),'SIGNATURE'=>getenv('PAYPAL_NVP_SIGNATURE')],$params));
 $curl=curl_init('https://api-3t.sandbox.paypal.com/nvp');curl_setopt_array($curl,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$body,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>30]);$raw=curl_exec($curl);$status=curl_getinfo($curl,CURLINFO_RESPONSE_CODE);if($raw===false){recordNvp($method,$status,['TRANSPORT_ERROR'=>curl_error($curl)]);curl_close($curl);throw new RuntimeException('Sandbox unavailable');}parse_str($raw,$result);curl_close($curl);recordNvp($method,$status,$result);if(!in_array($result['ACK'] ?? '',['Success','SuccessWithWarning']))throw new RuntimeException('NVP request declined');return $result;
}
/** Harness-only transcript: whitelist responses; never persist NVP credentials or buyer details. */
function recordNvp($method,$status,$response) {
 $file=getenv('SUNDOWN_NVP_TRANSCRIPT'); if(!$file)return;
 $safe=[];foreach($response as $key=>$value)if(preg_match('/^(ACK|CORRELATIONID|TOKEN|PAYMENTINFO_0_(TRANSACTIONID|PAYMENTSTATUS|AMT|CURRENCYCODE)|REFUNDTRANSACTIONID|REFUNDSTATUS|GROSSREFUNDAMT|L_(ERRORCODE|SHORTMESSAGE|LONGMESSAGE|SEVERITYCODE)[0-9]+|TRANSPORT_ERROR)$/',$key)){
  foreach(['PAYPAL_NVP_USER','PAYPAL_NVP_PWD','PAYPAL_NVP_SIGNATURE'] as $secretKey){$secret=getenv($secretKey);if($secret)$value=str_replace([$secret,urlencode($secret),rawurlencode($secret)],'[REDACTED]',$value);}
  $safe[$key]=$value;
 }
 file_put_contents($file,json_encode(['method'=>$method,'httpStatus'=>$status,'recordedAt'=>gmdate('c'),'source'=>'paypal-sandbox','response'=>$safe])."\n",FILE_APPEND|LOCK_EX);chmod($file,0600);
}
