import { integer, pgTable, serial, text, timestamp, real, jsonb } from "drizzle-orm/pg-core";

export const candidates = pgTable("candidates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  party: text("party").notNull(),
  constituency: text("constituency").notNull(),
  state: text("state").notNull().default(""),
  photo: text("photo").notNull().default(""),
  credibilityScore: integer("credibility_score").notNull(),
  criminalRisk: integer("criminal_risk").notNull(),
  financialTransparency: integer("financial_transparency").notNull(),
  performance: integer("performance").notNull(),
  criminalCases: integer("criminal_cases").notNull(),
  assets: text("assets").notNull(),
  liabilities: text("liabilities").notNull().default(""),
  education: text("education").notNull(),
  age: integer("age").notNull(),
  experience: text("experience").notNull(),
});

export const insights = pgTable("insights", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  year: integer("year").notNull(),
  constituency: text("constituency"),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const affidavitScans = pgTable("affidavit_scans", {
  id: serial("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  filename: text("filename").notNull(),
  status: text("status").notNull(),
  extractedText: text("extracted_text"),
  parsedData: jsonb("parsed_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Candidate = typeof candidates.$inferSelect;
export type AffidavitScan = typeof affidavitScans.$inferSelect;
