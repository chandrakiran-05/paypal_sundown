/** Known-shop template migration. Generated sources are reviewable and never deployed automatically. */
export const migratedSource = `<?php
/** Orders v2 sandbox shop; tokens are obtained on the server only. */
session_start();
require __DIR__.'/store.php';
function paypal($path,$body) {
 $c=curl_init('https://api-m.sandbox.paypal.com/v1/oauth2/token');
 curl_setopt_array($c,[CURLOPT_USERPWD=>getenv('PAYPAL_CLIENT_ID').':'.getenv('PAYPAL_CLIENT_SECRET'),CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>'grant_type=client_credentials',CURLOPT_RETURNTRANSFER=>true]);
 $auth=json_decode(curl_exec($c),true);curl_close($c);
 if(!isset($auth['access_token']))throw new RuntimeException('Sandbox OAuth failed');
 $c=curl_init('https://api-m.sandbox.paypal.com'.$path);
 curl_setopt_array($c,[CURLOPT_POST=>true,CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Bearer '.$auth['access_token'],'PayPal-Request-Id: '.hash('sha256',session_id().$path.json_encode($body))],CURLOPT_POSTFIELDS=>json_encode($body),CURLOPT_RETURNTRANSFER=>true]);
 $r=json_decode(curl_exec($c),true);$status=curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);if($status>=400)throw new RuntimeException('Sandbox request rejected');return $r;
}
$action=$_GET['action'] ?? '';
try {
if($action==='add' && $_SERVER['REQUEST_METHOD']==='POST') { $id=$_POST['product_id'] ?? ''; if(!in_array($id,array_column(products(),'id'),true))throw new RuntimeException('Unknown product'); if(!is_array($_SESSION['cart'] ?? null))$_SESSION['cart']=[]; $_SESSION['cart'][$id]=min(10,($_SESSION['cart'][$id] ?? 0)+1);header('Location: /');exit; }
if($action==='checkout') {
 if(cartCount()===0)throw new RuntimeException('Add a product before checkout.');
 if(getenv('PAYPAL_MODE')!=='live')throw new RuntimeException('Replay shop: use the Sundown workspace for synthetic parity. No sandbox request was made.');
 $r=paypal('/v2/checkout/orders',['intent'=>'CAPTURE','purchase_units'=>[['amount'=>['currency_code'=>'USD','value'=>amount()]]],'payment_source'=>['paypal'=>['experience_context'=>['return_url'=>base().'?action=capture','cancel_url'=>base().'?action=cancel']]]]);
 foreach($r['links'] ?? [] as $l)if(in_array($l['rel'],['approve','payer-action'])){header('Location: '.$l['href']);exit;}
}
if($action==='capture') { $r=paypal('/v2/checkout/orders/'.rawurlencode($_GET['token'] ?? '').'/capture',new stdClass());$db->prepare('INSERT OR IGNORE INTO orders(id,amount,status) VALUES (?,?,?)')->execute([$r['id'],amount(),$r['status']]); $_SESSION['cart']=[]; }
if($action==='refund' && $_SERVER['REQUEST_METHOD']==='POST')paypal('/v2/payments/captures/'.rawurlencode($_POST['id']).'/refund',['amount'=>['value'=>'12.00','currency_code'=>'USD']]);
} catch (Throwable $e) { http_response_code(400); $error=getenv('PAYPAL_MODE')==='live'?'Sandbox operation could not complete. Check approval and configuration.':$e->getMessage(); }
?><!doctype html><html lang="en"><meta charset="utf-8"><title>Horizon · Orders v2</title><style>body{background:#171918;color:#eee6d8;font:16px system-ui;max-width:820px;margin:60px auto;padding:20px}article{border-top:1px solid #444;padding:20px}button,a{color:#f69b68}button{background:#262a27;border:1px solid #555;padding:12px}</style><small><?=getenv('PAYPAL_MODE')==='live'?'LIVE SANDBOX':'REPLAY DATA'?></small><h1>Horizon Supply / Orders v2</h1><?php if(isset($error))echo '<p role="alert">'.htmlspecialchars($error).'</p>';foreach(products() as $p): ?><article><h2><?=htmlspecialchars($p['name'])?></h2><p>$<?=$p['price']?> USD</p><form method="post" action="?action=add"><input type="hidden" name="product_id" value="<?=htmlspecialchars($p['id'])?>"><button>Add to cart</button></form></article><?php endforeach ?><p>Cart: <?=cartCount()?> items · $<?=amount()?> USD</p><a href="?action=checkout">Checkout with PayPal sandbox</a></html>
`;
export const webhookSource = `<?php
/** verifyWebhook: verify signatures remotely before idempotent persistence. */
require __DIR__.'/store.php';
$event=json_decode(file_get_contents('php://input'),true);
if(getenv('PAYPAL_MODE')!=='live'){http_response_code(400);exit;}
$c=curl_init('https://api-m.sandbox.paypal.com/v1/oauth2/token');curl_setopt_array($c,[CURLOPT_USERPWD=>getenv('PAYPAL_CLIENT_ID').':'.getenv('PAYPAL_CLIENT_SECRET'),CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>'grant_type=client_credentials',CURLOPT_RETURNTRANSFER=>true]);$auth=json_decode(curl_exec($c),true);curl_close($c);
$c=curl_init('https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
$body=['auth_algo'=>$_SERVER['HTTP_PAYPAL_AUTH_ALGO'] ?? '', 'cert_url'=>$_SERVER['HTTP_PAYPAL_CERT_URL'] ?? '', 'transmission_id'=>$_SERVER['HTTP_PAYPAL_TRANSMISSION_ID'] ?? '', 'transmission_sig'=>$_SERVER['HTTP_PAYPAL_TRANSMISSION_SIG'] ?? '', 'transmission_time'=>$_SERVER['HTTP_PAYPAL_TRANSMISSION_TIME'] ?? '', 'webhook_id'=>getenv('PAYPAL_WEBHOOK_ID'),'webhook_event'=>$event];
curl_setopt_array($c,[CURLOPT_POST=>true,CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Bearer '.($auth['access_token'] ?? '')],CURLOPT_POSTFIELDS=>json_encode($body),CURLOPT_RETURNTRANSFER=>true]);$r=json_decode(curl_exec($c),true);curl_close($c);
if(($r['verification_status'] ?? '')!=='SUCCESS'){http_response_code(400);exit;}
$db->prepare('INSERT OR IGNORE INTO notifications(id,payload) VALUES (?,?)')->execute([$event['id'],json_encode(['event_type'=>$event['event_type']])]);http_response_code(200);
`;
export function unifiedDiff(before: string, after: string, path = "index.php") {
  const a = before ? before.trimEnd().split("\n") : [],
    b = after ? after.trimEnd().split("\n") : [];
  return (
    `--- ${before ? "a/" + path : "/dev/null"}\n+++ ${after ? "b/" + path : "/dev/null"}\n@@ -${a.length ? 1 : 0},${a.length} +${b.length ? 1 : 0},${b.length} @@\n` +
    a
      .map((l) => "-" + l)
      .concat(b.map((l) => "+" + l))
      .join("\n") +
    "\n"
  );
}
