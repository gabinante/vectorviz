#!/usr/bin/env python3
"""
Script to load sample data into Weaviate for testing VectorViz.
"""

import weaviate
from weaviate.classes.config import Configure, Property, DataType


SAMPLE_ARTICLES = [
    {
        "title": "Introduction to Machine Learning",
        "content": "Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience.",
        "category": "AI",
    },
    {
        "title": "Deep Learning Fundamentals",
        "content": "Deep learning uses neural networks with many layers to learn representations of data.",
        "category": "AI",
    },
    {
        "title": "Natural Language Processing",
        "content": "NLP is a field of AI that gives machines the ability to read, understand, and derive meaning from human languages.",
        "category": "AI",
    },
    {
        "title": "Computer Vision Applications",
        "content": "Computer vision enables machines to interpret and make decisions based on visual data from the world.",
        "category": "AI",
    },
    {
        "title": "Reinforcement Learning",
        "content": "Reinforcement learning trains agents to make sequences of decisions by rewarding desired behaviors.",
        "category": "AI",
    },
    {
        "title": "Vector Databases Explained",
        "content": "Vector databases store and query high-dimensional vectors for similarity search applications.",
        "category": "Database",
    },
    {
        "title": "Building Search Systems",
        "content": "Modern search systems use embeddings and vector similarity to find relevant documents.",
        "category": "Search",
    },
    {
        "title": "Recommendation Engines",
        "content": "Recommendation systems use user preferences and item embeddings to suggest relevant content.",
        "category": "ML",
    },
    {
        "title": "Semantic Search",
        "content": "Semantic search understands the meaning behind queries to find conceptually similar results.",
        "category": "Search",
    },
    {
        "title": "Embedding Models",
        "content": "Embedding models convert text, images, and other data into dense vector representations.",
        "category": "ML",
    },
    {
        "title": "Transfer Learning",
        "content": "Transfer learning applies knowledge from one task to improve learning on a related task.",
        "category": "ML",
    },
    {
        "title": "Transformer Architecture",
        "content": "Transformers use attention mechanisms to process sequential data in parallel.",
        "category": "AI",
    },
    {
        "title": "BERT and Language Models",
        "content": "BERT is a transformer-based model that understands language context bidirectionally.",
        "category": "NLP",
    },
    {
        "title": "GPT and Text Generation",
        "content": "GPT models generate human-like text by predicting the next token in a sequence.",
        "category": "NLP",
    },
    {
        "title": "Dimensionality Reduction",
        "content": "Techniques like UMAP and t-SNE reduce high-dimensional data for visualization.",
        "category": "ML",
    },
    {
        "title": "Clustering Algorithms",
        "content": "Clustering groups similar data points together without predefined labels.",
        "category": "ML",
    },
    {
        "title": "Neural Network Optimization",
        "content": "Optimizers like Adam and SGD update neural network weights to minimize loss.",
        "category": "AI",
    },
    {
        "title": "Data Preprocessing",
        "content": "Data preprocessing cleans and transforms raw data for machine learning models.",
        "category": "ML",
    },
    {
        "title": "Feature Engineering",
        "content": "Feature engineering creates new features from raw data to improve model performance.",
        "category": "ML",
    },
    {
        "title": "Model Evaluation",
        "content": "Metrics like accuracy, precision, and recall measure model performance.",
        "category": "ML",
    },
]


def main():
    print("Connecting to Weaviate...")
    client = weaviate.connect_to_local()

    try:
        # Delete existing collection if it exists
        if client.collections.exists("Articles"):
            print("Deleting existing Articles collection...")
            client.collections.delete("Articles")

        # Create collection
        print("Creating Articles collection...")
        client.collections.create(
            name="Articles",
            vectorizer_config=Configure.Vectorizer.text2vec_transformers(),
            properties=[
                Property(name="title", data_type=DataType.TEXT),
                Property(name="content", data_type=DataType.TEXT),
                Property(name="category", data_type=DataType.TEXT),
            ],
        )

        # Insert sample data
        print(f"Inserting {len(SAMPLE_ARTICLES)} sample articles...")
        articles = client.collections.get("Articles")

        with articles.batch.dynamic() as batch:
            for article in SAMPLE_ARTICLES:
                batch.add_object(properties=article)

        print("Sample data loaded successfully!")

        # Verify
        count = articles.aggregate.over_all(total_count=True).total_count
        print(f"Total objects in collection: {count}")

    finally:
        client.close()


if __name__ == "__main__":
    main()
