import type { Branding, Coupon, CouponRedemption, CountryConfig, ReferralCode, ReferralUse } from "../model";

export interface ICouponRepository {
  find(code: string): Promise<Coupon | undefined>;
  findAll(): Promise<Coupon[]>;
  save(c: Coupon): Promise<void>;
  /** Suma un uso sólo si no se pasó del máximo (atómico). */
  incrementRedemptions(code: string): Promise<boolean>;
  /** Registra el uso; ConflictError si ese sujeto ya lo usó. */
  addRedemption(r: CouponRedemption): Promise<void>;
  findRedemption(code: string, subjectKey: string): Promise<CouponRedemption | undefined>;
  findRedemptionsBySubject(subjectKey: string): Promise<CouponRedemption[]>;
}

export interface IReferralRepository {
  findCodeByOwner(ownerId: string): Promise<ReferralCode | undefined>;
  findCode(code: string): Promise<ReferralCode | undefined>;
  /** ConflictError si el código ya existe. */
  insertCode(c: ReferralCode): Promise<void>;
  findUse(referredUserId: string): Promise<ReferralUse | undefined>;
  saveUse(u: ReferralUse): Promise<void>;
  findUsesByReferrer(referrerId: string): Promise<ReferralUse[]>;
}

export interface IBrandingRepository {
  find(organizationId: string): Promise<Branding | undefined>;
  findByDomain(domain: string): Promise<Branding | undefined>;
  save(b: Branding): Promise<void>;
}

/** Consulta DNS (registros TXT) para verificar dominios propios. */
export interface IDnsTxtResolver {
  resolveTxt(name: string): Promise<string[]>;
}

export interface ICountryRegistry {
  get(code?: string): CountryConfig;
  all(): CountryConfig[];
  has(code: string): boolean;
}
