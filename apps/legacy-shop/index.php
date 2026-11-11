<?php
/** Sandbox-only legacy catalog, cart and NVP checkout demo. */
session_start();
require __DIR__.'/store.php';
$action = $_GET['action'] ?? '';
try {
 if ($action === 'add' && $_SERVER['REQUEST_METHOD'] === 'POST') { $id=$_POST['product_id'] ?? ''; if(!in_array($id,array_column(products(),'id'),true))throw new RuntimeException('Unknown product'); if(!is_array($_SESSION['cart'] ?? null))$_SESSION['cart']=[]; $_SESSION['cart'][$id]=min(10,($_SESSION['cart'][$id] ?? 0)+1); header('Location: /'); exit; }
 if ($action === 'checkout') {
  if(cartCount()===0)throw new RuntimeException('Cart is empty');
  $_SESSION['checkout_id']=bin2hex(random_bytes(12));
  unset($_SESSION['paypal_token']);
  $r = nvp('SetExpressCheckout', ['PAYMENTREQUEST_0_AMT'=>amount(),'PAYMENTREQUEST_0_CURRENCYCODE'=>'USD','PAYMENTREQUEST_0_PAYMENTACTION'=>'Sale','RETURNURL'=>base().'?action=return','CANCELURL'=>base().'?action=cancel']);
  $_SESSION['paypal_token']=$r['TOKEN'];
  if (getenv('PAYPAL_MODE') === 'live') { header('Location: https://www.sandbox.paypal.com/cgi-bin/webscr?cmd=_express-checkout&token='.urlencode($r['TOKEN'])); exit; }
  header('Location: /?action=return&token=REPLAY-TOKEN&PayerID=REPLAY-BUYER'); exit;
 }
 if ($action === 'return') {
  $token = $_GET['token'] ?? ''; $payer = $_GET['PayerID'] ?? '';
  if (!$payer || !$token || !hash_equals($_SESSION['paypal_token'] ?? '', $token)) throw new RuntimeException('Checkout return does not match this session');
  nvp('GetExpressCheckoutDetails',['TOKEN'=>$token]);
  $r = nvp('DoExpressCheckoutPayment',['TOKEN'=>$token,'PAYERID'=>$payer,'PAYMENTREQUEST_0_AMT'=>amount(),'PAYMENTREQUEST_0_CURRENCYCODE'=>'USD','PAYMENTREQUEST_0_PAYMENTACTION'=>'Sale']);
  $stmt=$db->prepare('INSERT OR IGNORE INTO orders (id,amount,status) VALUES (?,?,?)');$stmt->execute([$r['PAYMENTINFO_0_TRANSACTIONID'] ?? $token,amount(),'COMPLETED']);
  $_SESSION['cart']=[];
 }
 if ($action === 'refund' && $_SERVER['REQUEST_METHOD']==='POST') { nvp('RefundTransaction',['TRANSACTIONID'=>$_POST['id'] ?? '', 'REFUNDTYPE'=>'Partial','AMT'=>'12.00','CURRENCYCODE'=>'USD']); }
} catch (Throwable $e) { http_response_code(502); $error='Sandbox checkout could not complete. Check server configuration.'; }
?>
<!doctype html><html lang="en"><meta charset="utf-8"><title>Horizon Supply · Legacy sandbox shop</title><style>body{background:#171918;color:#eee6d8;font:16px system-ui;max-width:820px;margin:80px auto;padding:20px}h1{font:64px Georgia}button,a{color:#f69b68}button{background:#262a27;border:1px solid #555;padding:14px}article{border-top:1px solid #444;padding:30px 0}small{color:#9da49c}</style><small>SUNDOWN / LEGACY SHOP · <?=getenv('PAYPAL_MODE')==='live'?'LIVE SANDBOX':'REPLAY DATA'?></small><h1>Horizon Supply.</h1><p>Everyday objects, thoughtfully made.</p><?php if(isset($error)) echo '<p role="alert">'.$error.'</p>'; ?><?php foreach(products() as $p): ?><article><h2><?=htmlspecialchars($p['name'])?></h2><p>$<?=$p['price']?> USD</p><form method="post" action="?action=add"><input type="hidden" name="product_id" value="<?=htmlspecialchars($p['id'])?>"><button>Add to cart</button></form></article><?php endforeach ?><p>Cart: <?=cartCount()?> items · $<?=amount()?></p><a href="?action=checkout">Checkout with PayPal sandbox →</a><p><?= $action==='return'&&!isset($error)?(getenv('PAYPAL_MODE')==='live'?'Sandbox payment completed.':'Synthetic replay payment completed.'):($action==='cancel'?'Checkout cancelled.':'') ?></p></html>
