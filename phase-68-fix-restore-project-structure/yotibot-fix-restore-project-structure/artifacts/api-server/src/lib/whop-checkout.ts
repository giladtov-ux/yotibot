import { whopUrl } from "./payment-policy.ts";

type CheckoutRegistration = {
  id: string;
  telegram_id: string;
};

export async function createWhopCheckout(
  client: any,
  input: {
    companyId: string;
    planId: string;
    registration: CheckoutRegistration;
    redirectUrl: string;
  },
) {
  const checkout = await client.checkoutConfigurations.create({
    account_id: input.companyId,
    plan_id: input.planId,
    metadata: {
      app: "ah_sheli",
      registration_id: input.registration.id,
      telegram_id: input.registration.telegram_id,
    },
    redirect_url: input.redirectUrl,
  }, { idempotencyKey: `ah-sheli-checkout-${input.registration.id}` });
  return { id: checkout.id, url: whopUrl(checkout.purchase_url) };
}
