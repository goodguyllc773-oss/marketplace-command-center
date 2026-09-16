-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Listing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inventoryItemId" TEXT,
    "platformAccountId" TEXT NOT NULL,
    "externalListingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "needsDelisting" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "views" INTEGER,
    "likes" INTEGER,
    "watchers" INTEGER,
    "offerCount" INTEGER,
    "messageCount" INTEGER,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Listing_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Listing_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Listing" ("createdAt", "currency", "externalListingId", "id", "inventoryItemId", "likes", "messageCount", "metadataJson", "offerCount", "platformAccountId", "price", "status", "title", "updatedAt", "url", "views", "watchers") SELECT "createdAt", "currency", "externalListingId", "id", "inventoryItemId", "likes", "messageCount", "metadataJson", "offerCount", "platformAccountId", "price", "status", "title", "updatedAt", "url", "views", "watchers" FROM "Listing";
DROP TABLE "Listing";
ALTER TABLE "new_Listing" RENAME TO "Listing";
CREATE UNIQUE INDEX "Listing_platformAccountId_externalListingId_key" ON "Listing"("platformAccountId", "externalListingId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
