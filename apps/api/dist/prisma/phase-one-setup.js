import { applyPhaseOneSetup } from "./phase-one-data.js";
import { prisma } from "../src/prisma.js";
async function main() {
    const result = await applyPhaseOneSetup({
        includeSamples: true
    });
    console.log(`Phase one setup completed. Platforms: ${result.platforms}, shops: ${result.shops}, collectors: ${result.collectors}.`);
}
main()
    .catch((error) => {
    console.error(error);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
