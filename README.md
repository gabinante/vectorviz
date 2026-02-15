# VectorViz

Explore vector embeddings from vector databases in 3D. Run one binary, open `localhost:8080` in your browser.

## Features

- **3D Visualization**: Interactive point cloud rendering using React Three Fiber
- **Multiple Projection Methods**: UMAP (default), t-SNE, and PCA for dimensionality reduction
- **Server-Side Projections**: All projections computed natively in Rust for speed
- **Semantic Search**: Search vectors by text query with highlighted results
- **Nearest Neighbor Exploration**: Click a point to see its k-nearest neighbors
- **Database Support**: Weaviate (more coming)

## Architecture

```
Browser (Vite/React)          Rust Binary (axum)
+------------------+  REST  +----------------------+
| React + Three.js |<------>| HTTP Server (axum)   |
| Visualization    |        | Weaviate Client      |
| (no projections) |        | UMAP / t-SNE / PCA   |
+------------------+        +----------+-----------+
                                       | HTTP
                                  Weaviate / etc.
```

- Single Rust binary serves both the frontend SPA and the REST API
- Projections computed server-side using native Rust (UMAP, t-SNE, PCA)
- Frontend just renders — no WASM, no WebGPU

## Quick Start

### Production

```bash
# Build everything
make build

# Run the server (serves frontend on :8080)
cd server && ./target/release/vectorviz-server
```

Open `http://localhost:8080` in your browser.

### Development

```bash
# Terminal 1: Vite dev server (hot reload, proxies API to :8080)
make dev

# Terminal 2: Rust server
make dev-server

# Terminal 3: Weaviate (optional, for testing)
docker-compose -f docker-compose.dev.yml up
```

## Project Structure

```
vectorviz/
├── frontend/                # React + TypeScript frontend
│   ├── src/
│   │   ├── components/     # React components (PointCloud, Controls, etc.)
│   │   ├── hooks/          # Custom React hooks
│   │   ├── store/          # Zustand state management
│   │   └── api/            # REST API client (fetch-based)
│   └── package.json
├── server/                  # Rust server (axum)
│   ├── src/
│   │   ├── main.rs         # Entry point, static file serving
│   │   ├── api.rs          # REST endpoint handlers
│   │   ├── db/
│   │   │   ├── mod.rs      # Database trait + connection manager
│   │   │   └── weaviate.rs # Weaviate REST API client
│   │   └── projection/
│   │       ├── mod.rs      # Projection API + normalization
│   │       ├── umap.rs     # UMAP implementation
│   │       ├── tsne.rs     # t-SNE implementation
│   │       └── pca.rs      # PCA implementation
│   └── Cargo.toml
├── docker-compose.yml       # Weaviate for local testing
├── Makefile                 # Build commands
└── README.md
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/connect` | Configure DB connection |
| `GET` | `/api/status` | Connection status |
| `POST` | `/api/disconnect` | Disconnect from DB |
| `GET` | `/api/collections` | List collections |
| `GET` | `/api/collections/:name` | Collection info |
| `GET` | `/api/collections/:name/vectors` | Get vectors + projections |
| `POST` | `/api/collections/:name/search` | Semantic search |
| `GET` | `/api/collections/:name/vectors/:id/neighbors` | k-NN |

The `/api/collections/:name/vectors` endpoint accepts query params:
- `limit`, `offset` — pagination
- `method` — projection method (`umap`, `tsne`, `pca`)
- `n_neighbors`, `min_dist` — UMAP params
- `perplexity` — t-SNE param

Vectors are returned with projections already computed.

## Projection Parameters

### UMAP
- `n_neighbors`: Number of neighbors for local structure (default: 15)
- `min_dist`: Minimum distance between points (default: 0.1)

### t-SNE
- `perplexity`: Balance between local and global structure (default: 30)

### PCA
- No additional parameters (linear projection to 3D)

## License

MIT
