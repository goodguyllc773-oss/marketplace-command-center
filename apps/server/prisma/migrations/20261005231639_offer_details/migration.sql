-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingId" TEXT,
    "platformAccountId" TEXT NOT NULL,
    "externalOfferId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "role" TEXT NOT NULL DEFAULT 'SELLING',
    "offeredBy" TEXT,
    "itemTitle" TEXT,
    "itemUrl" TEXT,
    "originalPrice" REAL,
    "statusLabel" TEXT,
    "deadlineLabel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Offer_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Offer_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Offer" ("amount", "buyerName", "createdAt", "currency", "externalOfferId", "id", "listingId", "platformAccountId", "status", "updatedAt") SELECT "amount", "buyerName", "createdAt", "currency", "externalOfferId", "id", "listingId", "platformAccountId", "status", "updatedAt" FROM "Offer";
DROP TABLE "Offer";
ALTER TABLE "new_Offer" RENAME TO "Offer";
CREATE UNIQUE INDEX "Offer_platformAccountId_externalOfferId_key" ON "Offer"("platformAccountId", "externalOfferId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
