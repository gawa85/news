import type { Plan, Subscription } from "../../domain/model";
import type { IPaymentGateway } from "../../domain/ports";

/**
 * Pasarela de pagos de prueba. Para producción se implementa IPaymentGateway con
 * Mercado Pago (preapproval / suscripciones) o Stripe (Checkout Sessions), y su
 * webhook de confirmación llama a ConfirmPaymentUseCase.
 */
export class FakePaymentGateway implements IPaymentGateway {
  readonly checkouts: { subscriptionId: string; planId: string; amount: number }[] = [];

  constructor(private readonly baseUrl = "https://pagos.example/checkout") {}

  async createCheckout(sub: Subscription, plan: Plan): Promise<{ checkoutUrl: string }> {
    this.checkouts.push({ subscriptionId: sub.id, planId: plan.id, amount: sub.charged?.amount ?? plan.price?.amount ?? 0 });
    return { checkoutUrl: `${this.baseUrl}/${sub.id}` };
  }
}

/**
 * Emisor de facturas de prueba. Para producción: `ArcaWsfeInvoiceIssuer`, que
 * obtiene un ticket de acceso con WSAA (certificado digital de la empresa) y pide el
 * CAE a WSFEv1 (FECAESolicitar), numerando con FECompUltimoAutorizado.
 * Se puede simular un corte de ARCA con `failNext`.
 */
export class FakeInvoiceIssuer {
  private last = new Map<string, number>();
  failNext = 0;
  readonly issued: { letter: string; number: number; total: number }[] = [];

  async issue(inv: { letter: string; pointOfSale: number; total: number }): Promise<{ number: number; cae: string; caeExpiry: string }> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("ARCA no respondió (simulado).");
    }
    const key = `${inv.pointOfSale}-${inv.letter}`;
    const number = (this.last.get(key) ?? 0) + 1;
    this.last.set(key, number);
    this.issued.push({ letter: inv.letter, number, total: inv.total });
    return { number, cae: String(70_000_000_000_000 + number), caeExpiry: "2099-12-31" };
  }
}
