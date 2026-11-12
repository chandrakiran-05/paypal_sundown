import { fixtureSchema, scan } from "@sundown/engine";
import PublicDemo from "../../components/public-demo";
import cancel from "../../../../fixtures/cancel.json";
import decline from "../../../../fixtures/decline.json";
import duplicate from "../../../../fixtures/duplicate.json";
import refund from "../../../../fixtures/refund.json";
import rounding from "../../../../fixtures/rounding.json";
import success from "../../../../fixtures/success.json";
export default function JudgeDemo() {
  const source =
    "// Reference checkout source, never executed\nSetExpressCheckout\nGetExpressCheckoutDetails\nDoExpressCheckoutPayment\nRefundTransaction\nhttps://api-3t.sandbox.paypal.com/nvp";
  return (
    <PublicDemo
      fixtures={[cancel, decline, duplicate, refund, rounding, success].map(
        (f) => fixtureSchema.parse(f),
      )}
      findings={scan({ "reference-checkout.php": source })}
      source={source}
    />
  );
}
