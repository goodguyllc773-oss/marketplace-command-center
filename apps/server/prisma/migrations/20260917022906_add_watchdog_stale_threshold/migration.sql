-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Watchdog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformAccountId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'STOPPED',
    "lastSuccessAt" DATETIME,
    "lastEventAt" DATETIME,
    "lastError" TEXT,
    "intervalMs" INTEGER NOT NULL DEFAULT 30000,
    "staleAfterMs" INTEGER NOT NULL DEFAULT 120000,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Watchdog_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Watchdog" ("id", "intervalMs", "lastError", "lastEventAt", "lastSuccessAt", "platformAccountId", "state", "updatedAt") SELECT "id", "intervalMs", "lastError", "lastEventAt", "lastSuccessAt", "platformAccountId", "state", "updatedAt" FROM "Watchdog";
DROP TABLE "Watchdog";
ALTER TABLE "new_Watchdog" RENAME TO "Watchdog";
CREATE UNIQUE INDEX "Watchdog_platformAccountId_key" ON "Watchdog"("platformAccountId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
