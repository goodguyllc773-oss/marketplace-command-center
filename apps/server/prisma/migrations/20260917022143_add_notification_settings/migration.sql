-- CreateTable
CREATE TABLE "NotificationSetting" (
    "eventType" TEXT NOT NULL PRIMARY KEY,
    "discordEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
