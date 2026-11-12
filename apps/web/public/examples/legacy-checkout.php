<?php
// Example input for Sundown's source assessment. No requests are executed.
function legacyCheckoutMethods() {
    return [
        'endpoint' => 'https://api-3t.sandbox.paypal.com/nvp',
        'create' => 'SetExpressCheckout',
        'details' => 'GetExpressCheckoutDetails',
        'capture' => 'DoExpressCheckoutPayment',
        'refund' => 'RefundTransaction',
    ];
}
