import { applyPhaseOneSetup } from "./phase-one-data.js";
import { prisma } from "../src/prisma.js";

async function main() {
  await prisma.messageEvent.deleteMany();
  await prisma.message.deleteMany();
  await prisma.qualityAlert.deleteMany();
  await prisma.chatObservation.deleteMany();
  await prisma.collectorLog.deleteMany();
  await prisma.alertRule.deleteMany();
  await prisma.riskRule.deleteMany();
  await prisma.shopAccount.deleteMany();
  await prisma.collector.deleteMany();
  await prisma.platform.deleteMany();
  await prisma.user.deleteMany();

  const result = await applyPhaseOneSetup({
    includeSamples: true,
    overwriteCollectorStatus: true
  });

  console.log(
    `Seed completed. Users: ${result.users}, platforms: ${result.platforms}, shops: ${result.shops}, collectors: ${result.collectors}.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
