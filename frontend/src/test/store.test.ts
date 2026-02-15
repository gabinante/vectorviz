import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useVectorStore } from '../store/useVectorStore'

// Mock the API client
vi.mock('../api/client', () => ({
  api: {
    listCollections: vi.fn(),
    getVectors: vi.fn(),
    search: vi.fn(),
    getNeighbors: vi.fn(),
  },
}))

describe('useVectorStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useVectorStore.setState({
      collections: [],
      currentCollection: null,
      vectors: [],
      searchResults: [],
      selectedVector: null,
      neighbors: [],
      totalCount: 0,
      projectionMethod: 'umap',
      nNeighbors: 15,
      minDist: 0.1,
      perplexity: 30,
      isLoading: false,
      error: null,
      showSearchResults: false,
    })
  })

  it('should have correct initial state', () => {
    const state = useVectorStore.getState()
    expect(state.collections).toEqual([])
    expect(state.currentCollection).toBeNull()
    expect(state.vectors).toEqual([])
    expect(state.projectionMethod).toBe('umap')
    expect(state.isLoading).toBe(false)
  })

  it('should set projection method', () => {
    const { setProjectionMethod } = useVectorStore.getState()
    setProjectionMethod('tsne')

    expect(useVectorStore.getState().projectionMethod).toBe('tsne')
  })

  it('should update projection params', () => {
    const { setProjectionParams } = useVectorStore.getState()
    setProjectionParams({ nNeighbors: 20, minDist: 0.2 })

    const state = useVectorStore.getState()
    expect(state.nNeighbors).toBe(20)
    expect(state.minDist).toBe(0.2)
    expect(state.perplexity).toBe(30) // unchanged
  })

  it('should clear search results', () => {
    // Set some search results first
    useVectorStore.setState({
      searchResults: [{ id: 'v1', vector: null, metadata: {}, projection: null, distance: null }],
      showSearchResults: true,
    })

    const { clearSearch } = useVectorStore.getState()
    clearSearch()

    const state = useVectorStore.getState()
    expect(state.searchResults).toEqual([])
    expect(state.showSearchResults).toBe(false)
  })

  it('should select and deselect vectors', () => {
    const testVector = {
      id: 'v1',
      vector: [1, 2, 3],
      metadata: { title: 'Test' },
      projection: [0.1, 0.2, 0.3] as [number, number, number],
      distance: null,
    }

    const { selectVector } = useVectorStore.getState()

    // Select
    selectVector(testVector)
    expect(useVectorStore.getState().selectedVector).toEqual(testVector)

    // Deselect
    selectVector(null)
    expect(useVectorStore.getState().selectedVector).toBeNull()
  })
})
