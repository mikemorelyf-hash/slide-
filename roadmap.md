Below is a cleaner, developer-ready version of your friend’s prompt. You can give this to a developer or use it as the main project specification.

---

# Telegram Ride Pool Bot Specification

## Project Goal

We want to build a **Telegram bot** for shared ride pooling.

The first version will be a **Telegram bot built with Node.js**, deployed on **Railway**, and connected to a Telegram Bot API token.

In the future, we will build a **Telegram Mini App** using **React**, deployed on **Vercel**, which will open inside the Telegram bot. But for now, the priority is the Telegram bot.

---

# Phase 1: Telegram Bot

## Tech Stack

### Backend

- **Node.js**
- Telegram bot framework, for example:
  - `telegraf`
  - or `node-telegram-bot-api`
- Database:
  - PostgreSQL recommended
  - Can use Railway PostgreSQL
- Deployment:
  - Railway

### Telegram

The bot will be used by passengers and drivers.

There should also be a **driver group chat** where job alerts are posted.

---

# Main User Flow

## 1. Passenger Opens the Bot

When a user opens the bot, they should see a list of available routes.

Example routes:

```text
Mexico → Bole
Mexico → Piyasa
Mexico → CMC
Mexico → Hayat
Mexico → 4 Killo
Mexico → Megenagna
```

The routes should be displayed as Telegram inline buttons.

---

## 2. Passenger Selects a Route

After the passenger taps a route, the bot checks if there is an **active open pool** for that route.

An active open pool means:

- The pool is not full
- The pool has fewer than 4 passengers
- The pool has not already been sent to drivers
- The pool is still available for joining

---

## 3. If an Open Pool Exists

If there is an open pool for the selected route, the passenger can tap:

```text
Join Pool
```

After joining, the user should go through payment confirmation.

Then the passenger receives:

- Pool PIN code
- Current number of passengers in the pool
- Contact information/location details of other passengers, if allowed
- Message saying they will be notified when the pool is ready

All passengers in the same pool receive the **same PIN code**.

Example PIN:

```text
4334
```

---

## 4. If No Open Pool Exists

If there is no active pool for that route, the passenger sees:

```text
No active pool available for this route.
```

Then they can tap:

```text
Create Pool
```

After creating a pool, the passenger becomes the **captain passenger** of that pool.

The captain passenger is the first person who created the pool.

After creating the pool:

- A new unique PIN code is generated
- The pool is saved in the database
- The captain passenger receives the PIN code
- Other passengers can now join this pool

---

# Pool Rules

## Passenger Limit

Each pool should normally contain **4 passengers**.

When the pool reaches 4 passengers, the job is automatically sent to the driver group chat.

---

## PIN Code Rules

Each pool must have one unique PIN code.

Example:

```text
Pool A PIN: 4334
Pool B PIN: 9812
Pool C PIN: 5407
```

All passengers inside the same pool share the same PIN code.

The PIN is used later to confirm that the trip was completed.

---

# Payment Flow

When a passenger joins or creates a pool, a payment method popup or confirmation flow should appear.

For the first version, this can be handled simply inside Telegram with buttons such as:

```text
I Have Paid
Cancel
```

Later, real payment integration can be added.

Possible payment methods:

```text
Telebirr
CBE Birr
Cash
Manual confirmation
```

For MVP, we can use manual payment confirmation.

---

# Driver Flow

## 1. Pool Becomes Ready

When a pool reaches 4 passengers, the bot sends a job alert to the driver group chat.

The job alert should include:

- Route name
- Number of passengers
- Pickup/location information
- Pool PIN reference, if needed internally
- Button for drivers to accept the job

Example driver group message:

```text
New Ride Pool Available

Route: Mexico → Bole
Passengers: 4
Status: Ready

First driver to accept gets the job.
```

Button:

```text
Accept Job
```

---

## 2. First Driver Accepts the Job

The first driver who taps **Accept Job** gets assigned to the job.

After a driver accepts:

### Driver receives:

- Passenger names
- Passenger phone numbers
- Passenger pickup locations
- Number of passengers
- Route
- Pool PIN reminder
- Instructions to collect the PIN after the trip

### Passengers receive:

- Driver name
- Driver Telegram username
- Driver phone number, if available
- Vehicle information, if available
- Message saying the driver has accepted the trip

---

## 3. Deactivate Job Alert

After one driver accepts the job, the original job alert in the driver group should be updated.

Example:

```text
Job taken by driver @mike.
Please wait for another job soon.
```

The **Accept Job** button should no longer work after the job is taken.

If another driver taps it late, they should receive:

```text
Sorry, this job has already been taken.
```

---

# Driver Delay Rule

If the assigned driver is late by more than **10 minutes**, the job should be reposted to the driver group.

Possible logic:

- Once a driver accepts the job, start a 10-minute timer.
- If the trip has not been marked as started or completed within 10 minutes, repost the job.
- The previous driver assignment can be canceled or marked as expired.
- A new driver can accept the reposted job.

Example repost message:

```text
Job Reposted

The previous driver did not arrive on time.

Route: Mexico → Bole
Passengers: 4

First driver to accept gets the job.
```

---

# Trip Completion Flow

After the trip is successfully completed:

1. The driver asks the passengers for the pool PIN.
2. The driver sends the PIN to the admin or bot.
3. The bot/admin verifies the PIN.
4. The trip is marked as completed.
5. Payment to the driver can be processed manually by admin.

Example driver command:

```text
/complete 4334
```

If the PIN is valid:

```text
Trip completed successfully.
Admin has been notified for payment.
```

If the PIN is invalid:

```text
Invalid PIN. Please check with the passengers and try again.
```

---

# Early Dispatch Flow

Sometimes passengers may not want to wait until 4 people join the pool.

If passengers are in a hurry, they can agree to dispatch early.

## Rule

Only the **captain passenger** can start the early dispatch request.

The captain passenger should see a button:

```text
Let’s Go Now
```

This button should be available when:

- The pool has fewer than 4 passengers
- At least 1 passenger is in the pool
- The pool has not already been sent to drivers

---

## Early Dispatch Voting

When the captain taps **Let’s Go Now**, all other passengers in the pool receive a request.

Example message:

```text
The pool captain wants to dispatch early.

Route: Mexico → Bole
Current passengers: 2

Do you accept early dispatch?
```

Buttons:

```text
Accept Early Dispatch
Reject
```

If all passengers accept, the job is sent to the driver group even though the pool has fewer than 4 passengers.

If one passenger rejects, early dispatch is canceled.

---

## Early Dispatch Driver Alert

When an early dispatch pool is sent to the driver group, the job alert should clearly show that it is an early dispatch job.

Example:

```text
Early Dispatch Ride Pool

Route: Mexico → Bole
Passengers: 2
Status: Early Dispatch

Note to driver:
Ask passengers for the pool PIN after the trip.
Also collect the additional cash from passengers because they accepted early dispatch.
```

Button:

```text
Accept Job
```

---

## Driver Reminder for Early Dispatch

When a driver accepts an early dispatch job, the driver should receive an extra reminder:

```text
Reminder:
This is an early dispatch ride.

Ask the passengers for the pool PIN after the trip.

Also collect the additional cash from the passengers because they agreed to dispatch early.
```

---

# User Roles

## Passenger

A passenger can:

- Start the bot
- Select a route
- Join an existing pool
- Create a new pool
- Receive a PIN code
- Receive driver information
- Accept or reject early dispatch
- View current pool status

---

## Captain Passenger

The captain passenger is the first passenger who creates a pool.

A captain can:

- Do everything a normal passenger can do
- Start early dispatch voting by tapping **Let’s Go Now**

---

## Driver

A driver can:

- See job alerts in the driver group
- Accept available jobs
- Receive passenger information
- Complete the trip by submitting the PIN

---

## Admin

An admin can:

- View all pools
- View active jobs
- Verify completed trips
- Manage drivers
- Manage routes
- Manually confirm payments if needed
- Pay drivers manually after trip completion

---

# Database Models

A developer can design the database around these main entities.

## Users Table

Stores passengers, drivers, and admins.

Example fields:

```text
id
telegram_id
telegram_username
full_name
phone_number
role
created_at
updated_at
```

Possible roles:

```text
passenger
driver
admin
```

---

## Routes Table

Stores available routes.

Example fields:

```text
id
name
origin
destination
is_active
created_at
updated_at
```

Example route data:

```text
Mexico → Bole
Mexico → Piyasa
Mexico → CMC
Mexico → Hayat
Mexico → 4 Killo
Mexico → Megenagna
```

---

## Pools Table

Stores ride pools.

Example fields:

```text
id
route_id
pin_code
captain_user_id
status
max_passengers
early_dispatch_requested
early_dispatch_approved
created_at
updated_at
```

Possible statuses:

```text
open
ready
sent_to_drivers
driver_assigned
in_progress
completed
cancelled
expired
```

---

## Pool Passengers Table

Stores passengers inside each pool.

Example fields:

```text
id
pool_id
user_id
payment_status
early_dispatch_vote
joined_at
```

Possible payment statuses:

```text
pending
paid
cancelled
```

Possible early dispatch votes:

```text
pending
accepted
rejected
```

---

## Jobs Table

Stores driver job requests.

Example fields:

```text
id
pool_id
driver_id
driver_group_message_id
status
is_early_dispatch
accepted_at
expires_at
completed_at
created_at
updated_at
```

Possible statuses:

```text
open
accepted
expired
completed
cancelled
```

---

# Bot Commands

## Passenger Commands

```text
/start
```

Shows the route list.

```text
/my_pool
```

Shows the passenger’s current pool status.

```text
/cancel
```

Allows passenger to cancel before the pool is sent to drivers.

---

## Driver Commands

```text
/complete PIN
```

Example:

```text
/complete 4334
```

Used by driver to complete a trip after receiving PIN from passengers.

---

## Admin Commands

```text
/admin
```

Shows admin dashboard options.

```text
/pools
```

Shows active pools.

```text
/jobs
```

Shows active jobs.

```text
/routes
```

Manage route list.

---

# Example Bot Conversation

## Passenger Creates a Pool

```text
Passenger: /start

Bot:
Choose your route:

[Mexico → Bole]
[Mexico → Piyasa]
[Mexico → CMC]
[Mexico → Hayat]
[Mexico → 4 Killo]
[Mexico → Megenagna]

Passenger taps: Mexico → Bole

Bot:
No active pool found for Mexico → Bole.

[Create Pool]

Passenger taps: Create Pool

Bot:
Please confirm payment.

[I Have Paid]
[Cancel]

Passenger taps: I Have Paid

Bot:
Pool created successfully.

Route: Mexico → Bole
PIN: 4334
You are the captain passenger.
Passengers: 1/4

We will notify you when the pool is full.
```

---

## Passenger Joins Existing Pool

```text
Passenger: /start

Bot:
Choose your route:

Passenger taps: Mexico → Bole

Bot:
An active pool is available.

Route: Mexico → Bole
Passengers: 1/4

[Join Pool]

Passenger taps: Join Pool

Bot:
Please confirm payment.

[I Have Paid]
[Cancel]

Passenger taps: I Have Paid

Bot:
You joined the pool successfully.

Route: Mexico → Bole
PIN: 4334
Passengers: 2/4
```

---

## Pool Reaches 4 Passengers

```text
Bot to passengers:
Your pool is full.

Route: Mexico → Bole
Passengers: 4/4

Looking for a driver now.
```

Bot sends to driver group:

```text
New Ride Pool Available

Route: Mexico → Bole
Passengers: 4

[Accept Job]
```

---

## Driver Accepts Job

```text
Driver taps: Accept Job
```

Bot to driver:

```text
You accepted the job.

Route: Mexico → Bole
Passengers: 4

Passenger Details:
1. Abebe - phone number - location
2. Hana - phone number - location
3. Sami - phone number - location
4. Meron - phone number - location

After completing the trip, ask passengers for the PIN and send:

/complete PIN
```

Bot to passengers:

```text
Driver assigned.

Driver: Mike
Username: @mike
Phone: 09xxxxxxxx

Please contact the driver if needed.
```

Driver group message updates to:

```text
Job taken by driver @mike.
Please wait for another job soon.
```

---

# Important Business Rules

1. A pool can have a maximum of **4 passengers**.
2. Each pool must have a unique PIN.
3. The first passenger who creates the pool becomes the captain.
4. Only the captain can request early dispatch.
5. Early dispatch requires approval from all passengers in the pool.
6. Once a job is accepted by a driver, no other driver can accept it.
7. If the driver is late by more than 10 minutes, the job is reposted.
8. The trip is completed only when the driver submits the correct PIN.
9. Driver payment is handled after successful PIN verification.
10. The first version should work fully inside Telegram bot messages and buttons.

---

# Future Phase: Telegram Mini App

After the Telegram bot MVP is complete, we will build a React-based Telegram Mini App.

## Future Tech Stack

### Frontend

- React
- Vite or Next.js
- Deployed on Vercel
- Opened inside Telegram as a Mini App

### Backend

- Same Node.js backend from Phase 1
- API endpoints for:
  - Routes
  - Pools
  - Joining pools
  - Creating pools
  - Early dispatch voting
  - Driver assignment
  - Trip completion

---

## Mini App Features

The future React Mini App should allow passengers to:

- View route categories visually
- See active pools
- Create a pool
- Join a pool
- See pool status
- See passengers in the pool
- Request early dispatch
- Accept/reject early dispatch
- See driver information

Drivers may also have a Mini App dashboard later.

---

# MVP Scope

For the first version, we only need:

## Passenger Features

- `/start`
- Show route list
- Create pool
- Join pool
- Payment confirmation button
- PIN code generation
- Pool status
- Early dispatch flow

## Driver Features

- Send job alerts to driver group
- Accept job button
- Lock job after first driver accepts
- Send passenger info to driver
- Send driver info to passengers
- Repost job if driver is late by more than 10 minutes
- Complete trip using PIN

## Admin Features

- Basic admin commands
- View active pools
- View active jobs
- Verify completed trips manually if needed

---

# Final Developer Prompt

Use this as the actual instruction to the developer or AI coding assistant:

```text
Build a Telegram ride-pooling bot using Node.js.

The bot should be deployed on Railway and connected to Telegram Bot API.

Users open the bot and see a list of routes:
- Mexico → Bole
- Mexico → Piyasa
- Mexico → CMC
- Mexico → Hayat
- Mexico → 4 Killo
- Mexico → Megenagna

When a passenger selects a route, the bot checks if there is an active open pool for that route.

If an open pool exists, the passenger can join it after confirming payment.

If no open pool exists, the passenger can create a new pool after confirming payment.

The first passenger who creates a pool becomes the captain passenger.

Each pool has:
- A unique PIN code
- Maximum 4 passengers
- One route
- One captain passenger
- Status tracking

All passengers in the same pool receive the same PIN code.

When the pool reaches 4 passengers, the bot sends a job alert to a Telegram driver group chat.

The job alert should contain route, passenger count, and an Accept Job button.

The first driver to tap Accept Job gets the job.

After a driver accepts:
- The driver receives passenger names, phone numbers, locations, route, and trip details.
- The passengers receive the driver’s name, username, phone number, and vehicle info if available.
- The driver group message is updated to say the job has been taken.
- Other drivers cannot accept the same job.

If the assigned driver is late by more than 10 minutes, the job should be reposted to the driver group.

After the trip is completed, the driver asks the passengers for the pool PIN and sends the PIN to the bot/admin using a command like /complete 4334.

If the PIN is correct, the trip is marked as completed and admin is notified for driver payment.

Early dispatch:
If passengers do not want to wait for 4 people, the captain passenger can tap a “Let’s Go Now” button.
All current passengers must accept early dispatch.
If all passengers accept, the job is sent to the driver group even if the pool has fewer than 4 passengers.
For early dispatch jobs, the driver must receive a reminder to ask for the PIN and also collect the additional cash from passengers because they agreed to dispatch early.

Use PostgreSQL for the database.

Recommended tables:
- users
- routes
- pools
- pool_passengers
- jobs

The first version should be fully usable inside Telegram using bot messages and inline buttons.

Later, we will build a React Telegram Mini App deployed on Vercel that connects to the same backend.
```