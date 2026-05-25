import { createApp } from './app.js'
import { connectDatabase } from './config/database.js'
import { env } from './config/env.js'

await connectDatabase()

const app = createApp()
app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`FahamPesa backend listening on port ${env.PORT}`)
})
