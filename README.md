# IndiCrave VIT - microservices food ordering system

![Node.js](https://img.shields.io/badge/Node.js-18%2B-43853D?logo=node.js&logoColor=white)
![Version](https://img.shields.io/badge/version-1.0.0-blue)


IndiCrave VIT is a microservices-based food ordering platform built with Express and MongoDB.
It includes four backend services (Users, Restaurants, Orders, Payments) and a role-aware frontend for customers, restaurant owners, and delivery partners.

<img width="1600" height="848" alt="login" src="https://github.com/user-attachments/assets/da086074-a0d4-46b1-821c-f40c78cd062f" />

## Key Features

- End-to-end order flow: browse restaurants, add items, place orders, process payment, and track delivery.
- Multi-role experience in one app:
- `customer` can order and review.
- `restaurant_owner` can manage restaurant data, menus, and order states.
- `delivery_partner` can claim and complete deliveries.
- Clear microservice boundaries with separate databases per domain:
- `user_db`, `restaurant_db`, `order_db`, `payment_db`.
- Practical DBMS project architecture demonstrating schema design, service separation, and cross-service frontend orchestration.

## Project Structure

```text
IndiCraveVIT/
|-- backend/
|   |-- user_server.js
|   |-- restaurant_server.js
|   |-- order_server.js
|   |-- payment_server.js
|   `-- package.json
|-- frontend/
|   |-- index.html
|   |-- app.js
|   |-- styles.css
|   `-- assets/
`-- README.md
```

## Services and Ports

- User Service: `http://localhost:3000` ([backend/user_server.js](backend/user_server.js))
- Restaurant Service: `http://localhost:3001` ([backend/restaurant_server.js](backend/restaurant_server.js))
- Order Service: `http://localhost:3002` ([backend/order_server.js](backend/order_server.js))
- Payment Service: `http://localhost:3003` ([backend/payment_server.js](backend/payment_server.js))
- Frontend (static): [frontend/index.html](frontend/index.html)

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- MongoDB running locally on `mongodb://127.0.0.1:27017`

### 1. Install backend dependencies

```bash
cd backend
npm install
```

### 2. Start all backend microservices

Open 4 terminals inside [backend](backend):

```bash
node user_server.js
```

```bash
node restaurant_server.js
```

```bash
node order_server.js
```

```bash
node payment_server.js
```

### 3. Run the frontend

Option A: open [frontend/index.html](frontend/index.html) directly in your browser.

Option B (recommended): serve [frontend](frontend) with any static server (for example VS Code Live Server).

## Usage Examples

### Health checks

```bash
curl http://localhost:3000/
curl http://localhost:3001/
curl http://localhost:3002/
curl http://localhost:3003/
```

### Create roles (required before registration if roles collection is empty)

```bash
curl -X POST http://localhost:3000/roles \
	-H "Content-Type: application/json" \
	-d '{"role_name":"customer","permissions":["place_order","review"]}'

curl -X POST http://localhost:3000/roles \
	-H "Content-Type: application/json" \
	-d '{"role_name":"restaurant_owner","permissions":["manage_restaurant","manage_menu","update_orders"]}'

curl -X POST http://localhost:3000/roles \
	-H "Content-Type: application/json" \
	-d '{"role_name":"delivery_partner","permissions":["claim_order","mark_delivered"]}'
```

### Register and log in a customer

```bash
curl -X POST http://localhost:3000/users/register \
	-H "Content-Type: application/json" \
	-d '{"full_name":"Test User","email":"test@example.com","phone":"9876543210","password":"test123","role_name":"customer"}'

curl -X POST http://localhost:3000/users/login \
	-H "Content-Type: application/json" \
	-d '{"email":"test@example.com","password":"test123"}'
```

## Tech Stack

- Backend: Express, Mongoose, CORS, bcryptjs
- Frontend: HTML, CSS, Vanilla JavaScript
- Database: MongoDB (one DB per microservice)

Dependency source: [backend/package.json](backend/package.json)

## Where To Get Help

- Read service source files for route behavior and schema details:
- [backend/user_server.js](backend/user_server.js)
- [backend/restaurant_server.js](backend/restaurant_server.js)
- [backend/order_server.js](backend/order_server.js)
- [backend/payment_server.js](backend/payment_server.js)
- Open an issue in this repository with:
- exact endpoint + payload
- expected vs actual behavior
- relevant service logs

## Maintainers and Contributions

### Maintainer

- Kushaagra Sood

### Contributing

Contributions are welcome through pull requests.

Suggested lightweight workflow:

1. Fork the repository.
2. Create a feature branch.
3. Make small, focused commits with clear messages.
4. Add or update tests/check scripts where applicable.
5. Open a pull request describing what changed and why.

For larger changes, open an issue first to discuss scope and design.

## Notes

- Payment processing in [backend/payment_server.js](backend/payment_server.js) is simulated (randomized success/failure).
- Order and payment services are linked by `order_id`; refund flow is supported.
- This repository currently does not include CI config or a dedicated API docs site.
