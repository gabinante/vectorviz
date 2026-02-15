.PHONY: dev test clean

dev: ## Install deps, build frontend, start server on :8080
	cd frontend && npm install && npm run build
	cd server && cargo run
