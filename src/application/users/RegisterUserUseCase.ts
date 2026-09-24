import type { ChannelType, User } from "../../domain/model";
import type { IClock, IDomainEvents, IIdGenerator, IUnitOfWork } from "../../domain/ports";

export interface RegistrationDefaults {
  roleIds: string[];
  planId: string;
  /** Días de prueba del plan por defecto (0 = sin prueba, activo directo). */
  trialDays: number;
}

/**
 * Alta de usuario. Todo en UNA transacción: usuario + dirección de canal + suscripción.
 * Si la dirección ya es de otro usuario, no queda nada a medias.
 *
 * REGLA: un canal sólo se marca verificado si la dirección llegó probada
 * (p. ej. el mensaje vino desde ese número de WhatsApp, o el mail pasó SPF/DKIM).
 */
export class RegisterUserUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly defaults: RegistrationDefaults,
    private readonly events?: IDomainEvents,
  ) {}

  async execute(input: { name: string; channel?: { type: ChannelType; address: string; verified: boolean } }): Promise<User> {
    const now = this.clock.now();
    const user: User = {
      id: this.ids.next("user"),
      name: input.name.trim() || "Usuario",
      status: "active",
      roleIds: [...this.defaults.roleIds],
      channels: input.channel ? [{ channel: input.channel.type, address: input.channel.address, verified: input.channel.verified, linkedAt: now }] : [],
      preferredChannel: input.channel?.type,
      createdAt: now,
    };

    await this.uow.transaction(async (repos) => {
      await repos.users.save(user);
      if (input.channel) await repos.users.claimChannel(user.id, input.channel.type, input.channel.address);
      const trial = this.defaults.trialDays > 0;
      await repos.subscriptions.save({
        id: this.ids.next("sub"),
        subject: { type: "user", id: user.id },
        planId: this.defaults.planId,
        status: trial ? "trialing" : "active",
        currentPeriodEnd: new Date(now.getTime() + (trial ? this.defaults.trialDays : 3650) * 86_400_000),
        createdAt: now,
      });
    });
    await this.events?.emit("user.registered", { userId: user.id }, { channel: input.channel?.type ?? "web" }, { type: "user", id: user.id });
    return user;
  }
}
