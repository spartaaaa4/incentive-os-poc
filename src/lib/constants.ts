export const Vertical = {
  ELECTRONICS: "ELECTRONICS",
  GROCERY: "GROCERY",
  FNL: "FNL",
} as const;

export type Vertical = (typeof Vertical)[keyof typeof Vertical];

export const ApprovalStatus = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  ACTIVE: "ACTIVE",
} as const;

export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const EmployeeRole = {
  SM: "SM",
  DM: "DM",
  SA: "SA",
  BA: "BA",
} as const;

export type EmployeeRole = (typeof EmployeeRole)[keyof typeof EmployeeRole];

export const Channel = {
  OFFLINE: "OFFLINE",
  ONLINE: "ONLINE",
} as const;

export type Channel = (typeof Channel)[keyof typeof Channel];

export const TransactionType = {
  NORMAL: "NORMAL",
  SFS: "SFS",
  PAS: "PAS",
  JIOMART: "JIOMART",
} as const;

export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];
