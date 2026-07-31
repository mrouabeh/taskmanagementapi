import { redisClient } from '../redis'


export async function trackSession(userId: number, sid: string) {
  await redisClient.sAdd(`sessions:${userId}`, sid)
  await redisClient.expire(`sessions:${userId}`, 60 * 60 * 24 * 30)
}

export async function untrackSession(userId: number, sid: string) {
  await redisClient.sRem(`sessions:${userId}`, sid)
}
export async function revokeAllSessions(userId: number) {
  const sids = await redisClient.sMembers(`sessions:${userId}`)
  if (sids.length) await redisClient.del(sids.map((s) => `family:${s}`))
  await redisClient.del(`sessions:${userId}`)
}
