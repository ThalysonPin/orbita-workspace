import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const integrationCredentials = sqliteTable("integration_credentials", {
  ownerId: text("owner_id").notNull(), provider: text("provider").notNull(), companyId: text("company_id").notNull(),
  iv: text("iv").notNull(), ciphertext: text("ciphertext").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.ownerId, table.provider, table.companyId] })]);

export const integrationOAuthStates = sqliteTable("integration_oauth_states", {
  stateHash: text("state_hash").primaryKey(), ownerId: text("owner_id").notNull(), provider: text("provider").notNull(),
  companyId: text("company_id").notNull(), iv: text("iv").notNull(), ciphertext: text("ciphertext").notNull(), expiresAt: integer("expires_at").notNull(), consumedAt: integer("consumed_at"),
}, (table) => [index("integration_oauth_expiry_idx").on(table.expiresAt)]);
