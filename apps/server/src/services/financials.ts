export interface SaleFinancialInputs {
  salePrice: number;
  purchaseCost: number;
  platformFees: number;
  paymentFees: number;
  shippingCost: number;
  shippingRevenue: number;
  discount: number;
  refundAmount: number;
  otherCosts: number;
}

export interface SaleFinancialResult {
  netProfit: number;
  profitMargin: number;
}

/**
 * Spec section 11: NET PROFIT = sale revenue - purchase cost - platform
 * fees - payment fees - shipping expense - discounts - refunds - other
 * costs. `shippingRevenue` (what the buyer paid for shipping) isn't in that
 * subtraction list because it's revenue, not a cost — it's added back in
 * alongside `salePrice` rather than subtracted. Margin is against total
 * revenue actually collected (sale price + shipping revenue), not just
 * sale price, since that's the true income the sale generated.
 */
export function computeSaleFinancials(input: SaleFinancialInputs): SaleFinancialResult {
  const totalRevenue = input.salePrice + input.shippingRevenue;
  const netProfit =
    totalRevenue -
    input.purchaseCost -
    input.platformFees -
    input.paymentFees -
    input.shippingCost -
    input.discount -
    input.refundAmount -
    input.otherCosts;
  const profitMargin = totalRevenue > 0 ? netProfit / totalRevenue : 0;
  return { netProfit, profitMargin };
}
