/**
 * Resolve one roster row to an existing Elefin client — sheet-plan.md §5.
 * MT5 login first (via Account), then email; anything else is reported for
 * manual review rather than guessed. Only rows normalized to broker
 * "elefin" are attempted — everyone else has no live Elefin record to find.
 */
import { Account, Client } from "@elefin/db";
import type { Broker, MatchMethod } from "@elefin/db";

export interface MatchResult {
  linkedClientId: number | null;
  matchMethod: MatchMethod | null;
  needsReview: boolean;
  reviewReason: string | null;
}

export async function matchRosterRow(row: {
  brokerNormalized: Broker;
  mt5Login: string | null;
  mt5LoginRaw: string;
  email: string | null;
}): Promise<MatchResult> {
  if (row.brokerNormalized !== "elefin") {
    return { linkedClientId: null, matchMethod: null, needsReview: false, reviewReason: null };
  }

  if (row.mt5Login) {
    const account = await Account.findById(row.mt5Login, { clientId: 1 }).lean();
    if (account?.clientId != null) {
      return {
        linkedClientId: account.clientId,
        matchMethod: "mt5_login",
        needsReview: false,
        reviewReason: null,
      };
    }
  }

  if (row.email) {
    const client = await Client.findOne({ email: row.email }, { _id: 1 }).lean();
    if (client) {
      return {
        linkedClientId: client._id,
        matchMethod: "email",
        needsReview: false,
        reviewReason: null,
      };
    }
  }

  const reason =
    row.mt5LoginRaw && !row.mt5Login
      ? `Elefin per the sheet, but the User Id ("${row.mt5LoginRaw}") isn't a usable MT5 login and no email match was found`
      : "Elefin per the sheet, but no matching MT5 login or email was found — check spelling, or the client's email may be PII-masked in our data";
  return { linkedClientId: null, matchMethod: null, needsReview: true, reviewReason: reason };
}
