export type SimulatorTestCaseCategory = "success" | "error" | "payment_method" | "special_feature";

export type SimulatorTestCase = {
  name: string;
  amount: number;
  category: SimulatorTestCaseCategory;
  description: string;
  aliases: string[];
};

export const SIMULATOR_TEST_CASES: SimulatorTestCase[] = [
  { name: "successful_2s_delay", amount: 100001, category: "success", description: "Successful transaction with 2-second delay", aliases: ["success delay", "2 second delay", "successful transaction with 2-second delay"] },
  { name: "instant_success", amount: 100002, category: "success", description: "Instant successful transaction (0 seconds)", aliases: ["instant success", "0 second success", "instant successful transaction"] },
  { name: "rejected_by_processor", amount: 100003, category: "error", description: "Transaction rejected by payment processor", aliases: ["rejected", "processor rejected", "transaction rejected"] },
  { name: "customer_cancelled", amount: 100004, category: "error", description: "Transaction aborted (customer cancelled)", aliases: ["customer cancelled", "customer canceled", "aborted", "transaction aborted"] },
  { name: "card_removed", amount: 100005, category: "error", description: "Card removed during processing", aliases: ["card removed", "removed during processing"] },
  { name: "issuer_error", amount: 100006, category: "error", description: "Issuer error (bank declined)", aliases: ["issuer error", "bank declined", "issuer declined"] },
  { name: "internal_system_error", amount: 100007, category: "error", description: "Internal system error", aliases: ["internal error", "system error"] },
  { name: "network_connectivity_error", amount: 100008, category: "error", description: "Network connectivity error", aliases: ["network error", "connectivity error", "network connectivity"] },
  { name: "payment_method_not_accepted", amount: 100009, category: "error", description: "Card/payment method not accepted", aliases: ["payment method not accepted", "card not accepted", "method not accepted"] },
  { name: "contactless_pin_verified", amount: 100010, category: "payment_method", description: "Successful PIN-verified contactless transaction", aliases: ["pin verified contactless", "contactless pin"] },
  { name: "contactless_cardholder_verification", amount: 100011, category: "payment_method", description: "Successful contactless with cardholder verification", aliases: ["contactless cardholder verification", "contactless cvm"] },
  { name: "chip_without_pin", amount: 100012, category: "payment_method", description: "Successful chip card without PIN", aliases: ["chip without pin", "chip no pin"] },
  { name: "chip_with_pin", amount: 100013, category: "payment_method", description: "Successful chip card with PIN", aliases: ["chip with pin", "chip pin"] },
  { name: "magstripe_signature", amount: 100014, category: "payment_method", description: "Successful magnetic stripe with signature", aliases: ["magnetic stripe signature", "magstripe signature", "stripe signature"] },
  { name: "magstripe_pin", amount: 100015, category: "payment_method", description: "Successful magnetic stripe with PIN", aliases: ["magnetic stripe pin", "magstripe pin", "stripe pin"] },
  { name: "chip_with_pin_alternative", amount: 100016, category: "payment_method", description: "Successful chip card with PIN (alternative mode)", aliases: ["chip pin alternative", "alternative chip pin", "alternative mode"] },
  { name: "tip_10_percent", amount: 100017, category: "special_feature", description: "Successful transaction with 10% tip added", aliases: ["10% tip", "tip", "tip added"] },
  { name: "surcharge_1_5_percent", amount: 100018, category: "special_feature", description: "Successful transaction with 1.5% surcharge", aliases: ["1.5% surcharge", "surcharge", "surcharge added"] },
  { name: "dcc_enabled", amount: 100019, category: "special_feature", description: "Successful transaction with Dynamic Currency Conversion enabled", aliases: ["dcc", "dynamic currency conversion", "dcc enabled"] },
  { name: "success_30s_delay", amount: 100020, category: "success", description: "Successful transaction with 30-second delay", aliases: ["30 second delay", "success 30 seconds", "successful transaction with 30-second delay"] },
  { name: "loyalty_link_identity", amount: 100021, category: "special_feature", description: "Successful transaction with Nexi Loyalty Link customer identity in response", aliases: ["loyalty link", "loyalty identity", "customer identity"] },
];

const CASES_BY_AMOUNT = new Map(SIMULATOR_TEST_CASES.map((testCase) => [testCase.amount, testCase]));

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function searchValues(testCase: SimulatorTestCase): string[] {
  return [testCase.name, testCase.description, ...testCase.aliases].map(normalize);
}

export function findSimulatorTestCaseByAmount(amount: number): SimulatorTestCase | undefined {
  return CASES_BY_AMOUNT.get(amount);
}

export function findSimulatorTestCase(value: string): SimulatorTestCase | undefined {
  const normalized = normalize(value);
  if (!normalized) return undefined;

  return SIMULATOR_TEST_CASES.find((testCase) => searchValues(testCase).some((candidate) => candidate === normalized))
    ?? SIMULATOR_TEST_CASES.find((testCase) => searchValues(testCase).some((candidate) => candidate.includes(normalized) || normalized.includes(candidate)));
}

export function simulatorTestCaseNames(): string[] {
  return SIMULATOR_TEST_CASES.map((testCase) => testCase.name);
}
