import { isValidTaxId } from "../../domain/rules/taxIds";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import type { BillingProfile, Invoice, TaxCondition } from "../../domain/model";
import { invoiceLetter, isValidCuit, splitVat } from "../../domain/rules/invoiceRules";
import type {
  IAuthorizationService,
  ICountryRegistry,
  IBillingProfileRepository,
  IClock,
  IDomainEvents,
  IEventBus,
  IInvoiceIssuer,
  IInvoiceRepository,
  IJobQueue,
  IPlanRepository,
  ISubscriptionRepository,
  IUserRepository,
} from "../../domain/ports";
import { billingSubjectOf } from "../access/AccessControl";

export interface SellerConfig {
  taxCondition: "responsable_inscripto" | "monotributista";
  pointOfSale: number;
  vatRate: number;
}

/**
 * Datos fiscales de quien paga.
 * REGLAS: en una organización, los carga quien administra la suscripción;
 * responsable inscripto y monotributista requieren un CUIT válido.
 */
export class SetBillingProfileUseCase {
  constructor(
    private readonly profiles: IBillingProfileRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly clock: IClock,
    private readonly countries?: ICountryRegistry,
  ) {}

  async execute(input: { actorId: string; legalName: string; taxIdType: BillingProfile["taxIdType"]; taxId: string; taxCondition: TaxCondition; address?: string; email?: string; country?: string }): Promise<BillingProfile> {
    const actor = await this.users.findById(input.actorId);
    if (!actor) throw new NotFoundError("Usuario inexistente.");
    const subject = billingSubjectOf(actor);
    if (subject.type === "organization" && !(await this.authz.permissionsOf(actor)).has("subscriptions:manage_org")) {
      throw new AccessDeniedError("Los datos fiscales de la organización los carga quien administra la suscripción.", "no_permission");
    }
    const country = this.countries?.get(input.country) ;
    if (country && country.code !== "AR") {
      // Otros países: la identificación fiscal de ese país (RUT, RFC…), validada con su dígito verificador.
      if (input.country && !this.countries!.has(input.country)) throw new ValidationError(`No operamos en ${input.country}.`);
      const id = input.taxId.trim().toUpperCase();
      if (!isValidTaxId(country.taxId.kind, id)) throw new ValidationError(`${country.taxId.name} inválido.`);
      if (input.legalName.trim().length < 3) throw new ValidationError("Falta la razón social o el nombre.");
      const p: BillingProfile = { subject, legalName: input.legalName.trim(), taxIdType: country.taxId.name as BillingProfile["taxIdType"], taxId: id, taxCondition: "consumidor_final", address: input.address, email: input.email, country: country.code, updatedAt: this.clock.now() };
      await this.profiles.save(p);
      return p;
    }
    const taxId = input.taxId.replace(/\D/g, "");
    if (input.taxCondition === "responsable_inscripto" || input.taxCondition === "monotributista") {
      if (input.taxIdType !== "CUIT" || !isValidCuit(taxId)) throw new ValidationError("Para esa condición fiscal hace falta un CUIT válido.");
    } else if ((input.taxIdType === "CUIT" || input.taxIdType === "CUIL") && !isValidCuit(taxId)) {
      throw new ValidationError(`${input.taxIdType} inválido.`);
    }
    if (input.legalName.trim().length < 3) throw new ValidationError("Falta la razón social o el nombre.");
    const profile: BillingProfile = { subject, legalName: input.legalName.trim(), taxIdType: input.taxIdType, taxId, taxCondition: input.taxCondition, address: input.address, email: input.email, country: "AR", updatedAt: this.clock.now() };
    await this.profiles.save(profile);
    return profile;
  }
}

/**
 * Factura cada cobro confirmado.
 * - Escucha "payment.confirmed" y encola un trabajo: si ARCA no responde, se reintenta.
 * - Idempotente: una factura por suscripción cobrada.
 */
export class InvoicingService {
  constructor(
    private readonly invoices: IInvoiceRepository,
    private readonly profiles: IBillingProfileRepository,
    private readonly subscriptions: ISubscriptionRepository,
    private readonly plans: IPlanRepository,
    private readonly issuer: IInvoiceIssuer,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
    private readonly seller: SellerConfig,
  ) {}

  attach(bus: IEventBus, queue: IJobQueue): void {
    bus.subscribe(async (e) => {
      // Sin cobro (cupón del 100%) no hay factura; fuera de Argentina, el comprobante lo emite
      // el proveedor de pagos hasta integrar la factura electrónica de cada país.
      const country = (e.data.country as string | undefined) ?? "AR";
      if (e.type === "payment.confirmed" && e.target && e.data.amount !== 0 && country === "AR") {
        await queue.enqueue("issue_invoice", { subscriptionId: e.target.id }, { dedupeKey: `invoice:${e.target.id}`, maxAttempts: 8 });
      }
    });
  }

  async issueForSubscription(subscriptionId: string): Promise<Invoice> {
    const id = `inv_${subscriptionId}`;
    const existing = await this.invoices.findById(id);
    if (existing?.status === "issued") return existing;

    const sub = await this.subscriptions.findById(subscriptionId);
    if (!sub) throw new NotFoundError("No existe la suscripción.");
    const plan = await this.plans.findById(sub.planId);
    if (!plan?.price) throw new ValidationError("Plan sin precio: no se factura.");
    const profile = await this.profiles.find(sub.subject);
    const buyerCondition = profile?.taxCondition ?? "consumidor_final";
    const letter = invoiceLetter(this.seller.taxCondition, buyerCondition);
    const amount = sub.charged?.amount ?? plan.price.amount;
    const interval = sub.interval ?? plan.price.interval;
    const { net, vat } = splitVat(amount, letter, this.seller.vatRate);

    const draft: Invoice = {
      id,
      subject: sub.subject,
      subscriptionId,
      letter,
      pointOfSale: this.seller.pointOfSale,
      issueDate: this.clock.now(),
      buyer: profile && (profile.taxIdType === "CUIT" || profile.taxIdType === "CUIL" || profile.taxIdType === "DNI")
        ? { name: profile.legalName, taxIdType: profile.taxIdType, taxId: profile.taxId, taxCondition: profile.taxCondition }
        : { name: "Consumidor Final", taxIdType: "SIN_IDENTIFICAR", taxCondition: "consumidor_final" },
      lines: [{
        description: `Suscripción Sin Humo, plan ${plan.name} (${interval === "month" ? "mensual" : "anual"})${sub.charged?.couponCode ? `, cupón ${sub.charged.couponCode}` : ""}`,
        amount,
      }],
      net,
      vat,
      vatRate: letter === "C" ? 0 : this.seller.vatRate,
      total: amount,
      currency: sub.charged?.currency ?? plan.price.currency,
      status: "pending",
    };
    await this.invoices.save(draft);
    try {
      const r = await this.issuer.issue(draft);
      const issued: Invoice = { ...draft, status: "issued", number: r.number, cae: r.cae, caeExpiry: r.caeExpiry };
      await this.invoices.save(issued);
      const actor = sub.subject.type === "organization" ? { userId: "sistema:facturacion", organizationId: sub.subject.id } : { userId: sub.subject.id };
      await this.events.emit("invoice.issued", actor, { letter, total: issued.total, number: r.number }, { type: "invoice", id });
      return issued;
    } catch (err) {
      await this.invoices.save({ ...draft, status: "failed", error: err instanceof Error ? err.message : String(err) });
      throw err; // el trabajo se reintenta
    }
  }
}
