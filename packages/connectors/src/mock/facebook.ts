import { MockConnectorBase } from "./base.js";

const CATALOG = [
  { title: "Solid Wood Dining Table - 6 Seat", price: 220 },
  { title: "IKEA Kallax Shelf Unit - White", price: 55 },
  { title: "Nike Hoodie - Black - Size L", price: 30 },
  { title: "Electric Scooter - Barely Used", price: 180 },
];

const BUYERS = ["Jordan M.", "Casey P.", "Sam R.", "Taylor W."];

export class MockFacebookConnector extends MockConnectorBase {
  constructor(accountId: string, accountDisplayName: string) {
    super({
      platformId: "facebook",
      accountId,
      accountDisplayName,
      catalog: CATALOG,
      buyerNames: BUYERS,
      currency: "USD",
      // Facebook Marketplace sales are frequently local pickup with no
      // formal shipment/tracking flow — model that honestly rather than
      // inventing shipping data the real platform doesn't reliably expose.
      capabilities: ["messages", "sendMessages", "listings", "offers", "orders", "sales"],
    });
  }
}
