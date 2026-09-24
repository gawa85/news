import type {
  Category,
  DeclarativeRule,
  EffectivePreferences,
  OrgPreferenceDefaults,
  ParameterValue,
  Topic,
  User,
  UserPreferences,
} from "../model";

export interface ITaxonomyRepository {
  findCategories(): Promise<Category[]>;
  saveCategory(c: Category): Promise<void>;
  findTopics(): Promise<Topic[]>;
  findTopic(id: string): Promise<Topic | undefined>;
  saveTopic(t: Topic): Promise<void>;
}

/** Entiende lo que escribe la gente: "gas", "garrafa" → el tema "Tarifas de gas". */
export interface ITopicResolver {
  resolve(text: string): Promise<Topic | undefined>;
}

export interface IPreferencesRepository {
  findUser(userId: string): Promise<UserPreferences | undefined>;
  saveUser(p: UserPreferences): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  findOrg(organizationId: string): Promise<OrgPreferenceDefaults | undefined>;
  saveOrg(d: OrgPreferenceDefaults): Promise<void>;
  /** Quienes siguen un tema (para avisos y campañas). */
  findFollowers(topicId: string): Promise<UserPreferences[]>;
  /** Personas y organizaciones que pidieron un resumen (diario o semanal). */
  findUsersWithDigest(): Promise<UserPreferences[]>;
  findOrgsWithDigest(): Promise<OrgPreferenceDefaults[]>;
}

/** Preferencias efectivas de una persona (con los valores de su organización aplicados). */
export interface IPreferencesReader {
  effective(user: User): Promise<EffectivePreferences>;
}

export interface IBusinessRuleRepository {
  /** Última versión de cada regla. */
  findLatest(): Promise<DeclarativeRule[]>;
  findVersions(ruleId: string): Promise<DeclarativeRule[]>;
  findActive(): Promise<DeclarativeRule[]>;
  save(rule: DeclarativeRule): Promise<void>;
  findParameters(): Promise<ParameterValue[]>;
  parameterHistory(key: string): Promise<ParameterValue[]>;
  saveParameter(v: ParameterValue): Promise<void>;
}

/** Reglas declarativas vigentes que aplican a una persona (plataforma + su organización). */
export interface IDeclarativeRuleSource {
  rulesFor(organizationId?: string): Promise<DeclarativeRule[]>;
}

/** Parámetros de negocio editables (con valor por defecto en código). */
export interface IParameterStore {
  number(key: string): Promise<number>;
  boolean(key: string): Promise<boolean>;
  string(key: string): Promise<string>;
}
