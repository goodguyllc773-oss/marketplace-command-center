import { MOCK_PLATFORM_IDS, REAL_PLATFORM_IDS } from "@mcc/connectors";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PLATFORM_NAMES: Record<string, string> = {
  depop: "Depop",
  facebook: "Facebook",
  ebay: "eBay",
  "depop-live": "Depop (Live)",
  "facebook-live": "Facebook (Live)",
};

async function main() {
  for (const key of MOCK_PLATFORM_IDS) {
    await prisma.platform.upsert({
      where: { key },
      create: { key, name: PLATFORM_NAMES[key] ?? key, kind: "mock" },
      update: {},
    });
  }
  for (const key of REAL_PLATFORM_IDS) {
    await prisma.platform.upsert({
      where: { key },
      create: { key, name: PLATFORM_NAMES[key] ?? key, kind: "browser" },
      update: {},
    });
  }
  console.log(`Seeded platforms: ${[...MOCK_PLATFORM_IDS, ...REAL_PLATFORM_IDS].join(", ")}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
