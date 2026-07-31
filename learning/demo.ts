// A plain Error only holds a message.
const plain = new Error('something broke')
console.log('plain   ->', plain.message)

// Same thing, but it also carries a number.
class AppError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message) // let Error handle the message
    this.status = status // we add the extra field
  }
}

const mine = new AppError('email taken', 409)
console.log('mine    ->', mine.message, mine.status)

// Throwing and catching it:
try {
  throw new AppError('not logged in', 401)
} catch (err) {
  if (err instanceof AppError) {
    console.log('caught  ->', err.message, 'status:', err.status)
  }
}

// Makes this file a module so its top-level names stay local to it
// (otherwise `AppError` here collides with the one in lesson.ts).
export {}
