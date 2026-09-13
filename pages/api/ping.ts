import type { NextApiRequest, NextApiResponse } from "next"
import { log } from "../../lib/_log"

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): void {
  log(`ping ${new Date()}`)
  res.status(200).send(`ping ${new Date()}`)
}
