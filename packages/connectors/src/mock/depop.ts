import { MockConnectorBase } from "./base.js";

const CATALOG = [
  { title: "Vintage Carhartt Jacket - Size M", price: 68 },
  { title: "Y2K Baby Tee - Graphic Print", price: 22 },
  { title: "Nike Air Max 97 - Size 10", price: 95 },
  { title: "Levi's 501 Straight Leg Jeans", price: 45 },
];

const BUYERS = ["@thrifty.sage", "@vintagevault", "@sole.collector", "@moss.wears"];

export class MockDepopConnector extends MockConnectorBase {
  constructor(accountId: string, accountDisplayName: string) {
    super({
      platformId: "depop",
      accountId,
      accountDisplayName,
      catalog: CATALOG,
      buyerNames: BUYERS,
      currency: "USD",
    });
  }
}
