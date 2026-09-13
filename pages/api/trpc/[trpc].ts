import * as trpcNext from "@trpc/server/adapters/next"
import { appRouter } from "../../../lib/web/app_router"
import { createContext } from "../../../lib/web/context"
import { log } from "../../../lib/_log"

export default trpcNext.createNextApiHandler({
  router: appRouter,
  createContext,
  onError({ error }) {
    if (error.code === "INTERNAL_SERVER_ERROR") {
      log(error)
    }
  },
})
