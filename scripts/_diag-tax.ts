/**
 * TEMP read-only diagnostic: dump every branch's taxSettings + the Settings doc.
 * Usage: npx tsx scripts/_diag-tax.ts
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database.js'
import { BranchModel } from '../src/models/branch.model.js'
import { SettingsModel } from '../src/models/settings.model.js'

async function main() {
  await connectDatabase()
  const branches = await BranchModel.find({}, { name: 1, businessAccountId: 1, taxSettings: 1, status: 1, updatedAt: 1 }).lean()
  console.log(`=== BRANCHES (${branches.length}) ===`)
  for (const b of branches) {
    console.log(JSON.stringify({
      id: String(b._id),
      name: b.name,
      status: b.status,
      updatedAt: b.updatedAt,
      taxSettings: b.taxSettings ?? null
    }))
  }

  const settings = await SettingsModel.find({}).lean()
  console.log(`\n=== SETTINGS DOCS (${settings.length}) ===`)
  for (const s of settings) {
    console.log(JSON.stringify(s, null, 2))
  }
}

main()
  .then(async () => { await disconnectDatabase(); process.exit(0) })
  .catch(async (e) => { console.error('FAILED:', e instanceof Error ? e.message : e); await disconnectDatabase().catch(() => {}); process.exit(1) })
