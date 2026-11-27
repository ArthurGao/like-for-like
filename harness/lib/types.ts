/** A result row keyed by legacy ids, so legacy and new results can be joined. */
export type CompareRow = {
  /** The legacy record id (named for the first feature): a shift for timesheet, the clock-in event for clock-events. */
  legacyShiftId: number;
  tenant: string; // tenant name
  employeeId: number; // legacy employee id
  employee: string; // employee name
  work_date: string;
  paid_hours: string;
  gross_pay: string;
};

/** The legacy inputs behind one shift, shown next to a mismatch. */
export type ShiftInputs = {
  tenant: string;
  employeeId: number;
  timeZone: string;
  employee: string;
  rate: string;
  startLocal: string;
  endLocal: string;
  breakMin: number | null;
  status: number;
  active: boolean;
};

export type NamedCheck = { name: string; ok: boolean; detail?: string };
