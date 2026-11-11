<?php
/** Validate IPN with sandbox before storing one notification per transaction. */
require __DIR__.'/store.php';
if(getenv('PAYPAL_MODE')!=='live'){http_response_code(400);exit('Replay callbacks are handled by parity fixtures');}
$raw=file_get_contents('php://input');
$curl=curl_init('https://ipnpb.sandbox.paypal.com/cgi-bin/webscr');curl_setopt_array($curl,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>'cmd=_notify-validate&'.$raw,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>20]);
$verified=curl_exec($curl);curl_close($curl);if($verified!=='VERIFIED'){http_response_code(400);exit;}
$id=$_POST['txn_id'] ?? '';if(!$id){http_response_code(400);exit;}
$db->prepare('INSERT OR IGNORE INTO notifications(id,payload) VALUES (?,?)')->execute([$id,json_encode(['status'=>$_POST['payment_status'] ?? ''])]);http_response_code(200);
