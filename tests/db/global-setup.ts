import { startServer, buildTemplate } from './pg-harness'

export default async function setup() {
  const server = await startServer()
  await buildTemplate()
  return async () => {
    await server.stop()
  }
}
