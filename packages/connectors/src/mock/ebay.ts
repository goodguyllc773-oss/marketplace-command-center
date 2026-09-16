import { MockConnectorBase } from "./base.js";

const CATALOG = [
  { title: "PS5 Digital Edition Console", price: 380 },
  { title: "Vintage Pyrex Mixing Bowl Set", price: 65 },
  { title: "Canon EOS Rebel T7 DSLR Kit", price: 310 },
  { title: "Pokemon Booster Box - Sealed", price: 140 },
];

const BUYERS = ["retro_gamer99", "kitchenfinds", "shutterbug_dan", "cardcollector22"];

export class MockEbayConnector extends MockConnectorBase {
  constructor(accountId: string, accountDisplayName: string) {
    super({
      platformId: "ebay",
      accountId,
      accountDisplayName,
      catalog: CATALOG,
      buyerNames: BUYERS,
      currency: "USD",
    });
  }
}
