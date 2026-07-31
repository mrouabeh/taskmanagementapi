// ─────────────────────────────────────────────────────────────
// 1. WHAT A CLASS IS
// A class is a blueprint for making objects that carry data.
// ─────────────────────────────────────────────────────────────

// You already make objects by hand:
const user1 = { name: 'Sami', email: 'sami@x.com' }

// A class lets you stamp out many of the same shape:
class User {
  name: string
  email: string

  // `constructor` runs when you write `new User(...)`
  constructor(name: string, email: string) {
    this.name = name // `this` = the object being built right now
    this.email = email
  }

  // classes can also hold functions ("methods")
  greet() {
    return `Hi ${this.name}`
  }
}

const user2 = new User('Sami', 'sami@x.com')

console.log('1) plain object :', user1)
console.log('1) class object :', { name: user2.name, email: user2.email })
console.log('1) method       :', user2.greet())
console.log()

// ─────────────────────────────────────────────────────────────
// 2. EXTENDS + SUPER
// `extends` = "copy everything from that class, then add more"
// `super()` = "run the parent's constructor"
// ─────────────────────────────────────────────────────────────

class Admin extends User {
  permissions: string[]

  constructor(name: string, email: string, permissions: string[]) {
    super(name, email) // User's constructor sets name + email
    this.permissions = permissions // Admin adds its own field
  }
}

const boss = new Admin('Rania', 'rania@x.com', ['delete'])

console.log('2) inherited field  :', boss.name) // came from User
console.log('2) inherited method :', boss.greet()) // came from User
console.log('2) own field        :', boss.permissions) // Admin's own
console.log()

// ─────────────────────────────────────────────────────────────
// 3. ERROR IS JUST A CLASS TOO
// So you can extend it exactly like User above.
// ─────────────────────────────────────────────────────────────

class AppError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message) // Error's constructor handles `message`
    this.status = status // we add `status`
  }
}

const e = new AppError('email taken', 409)

console.log('3) message      :', e.message) // from Error
console.log('3) status       :', e.status) // ours
console.log('3) still real   :', e instanceof Error) // true
console.log()

// ─────────────────────────────────────────────────────────────
// 4. WHY THROW INSTEAD OF res.status()
// A function deep in your code has no `res`. Throwing lets it
// report failure and lets someone ELSE decide the HTTP response.
// ─────────────────────────────────────────────────────────────

// pretend service: knows about users, knows nothing about HTTP
function findUser(id: number) {
  if (id !== 1) {
    throw new AppError('User not found', 404)
  }
  return { id, name: 'Sami' }
}

// pretend route: knows about HTTP, doesn't care WHY it failed
function handleRequest(id: number) {
  try {
    const user = findUser(id)
    return { code: 200, body: user }
  } catch (err) {
    if (err instanceof AppError) {
      return { code: err.status, body: { message: err.message } }
    }
    return { code: 500, body: { message: 'Internal server error' } }
  }
}

console.log('4) good id :', handleRequest(1))
console.log('4) bad id  :', handleRequest(99))

// Makes this file a module so its top-level names stay local to it
// (otherwise `AppError` here collides with the one in demo.ts).
export {}
