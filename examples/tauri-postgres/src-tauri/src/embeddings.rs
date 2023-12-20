use fastembed::{EmbeddingBase, EmbeddingModel, FlagEmbedding, InitOptions};

/// Utility function for creating a model for all future functions
pub fn create_embedding_model() -> FlagEmbedding {
    // With custom InitOptions
    let model: FlagEmbedding = FlagEmbedding::try_new(InitOptions {
        model_name: EmbeddingModel::BGEBaseEN,
        show_download_message: true,
        ..Default::default()
    })
    .unwrap();

    model
}

/// Create embeddings for a github issue
pub fn embed_issue(issue: &str, model: FlagEmbedding) -> Vec<f32> {
    let embeddings = model.passage_embed(vec![issue], None).unwrap();

    embeddings.get(0).unwrap().to_vec()
}

/// Store embeddings in pgvector
pub fn format_embeddings(embeddings: Vec<f32>) -> String {
    let formatted_string = format!(
        "[{}]",
        embeddings
            .iter()
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );

    formatted_string
}

/// Get the query embeddings for your query, which you can use to probe the database
pub fn embed_query(query: &str, model: FlagEmbedding) -> String {
    let embeddings = model.query_embed(query).unwrap();

    let formatted_string = embeddings
        .iter()
        .map(|n| n.to_string())
        .collect::<Vec<_>>()
        .join(",")
        .to_string();

    formatted_string
}

#[test]
fn test_embeddings() {
    use fastembed::{EmbeddingBase, EmbeddingModel, FlagEmbedding, InitOptions};

    // With default InitOptions
    let model: FlagEmbedding = FlagEmbedding::try_new(Default::default()).unwrap();

    // With custom InitOptions
    let model: FlagEmbedding = FlagEmbedding::try_new(InitOptions {
        model_name: EmbeddingModel::BGEBaseEN,
        show_download_message: true,
        ..Default::default()
    })
    .unwrap();

    let documents = vec![
        "passage: Hello, World!",
        "query: Hello, World!",
        "passage: This is an example passage.",
        // You can leave out the prefix but it's recommended
        "fastembed-rs is licensed under MIT",
    ];

    // Generate embeddings with the default batch size, 256
    let embeddings = model.embed(documents, None).unwrap();

    println!("Embeddings length: {}", embeddings.len()); // -> Embeddings length: 4
    println!("Embedding dimension: {}", embeddings[0].len()); // -> Embedding dimension: 768
}

#[test]
fn test_embed_issue() {
    let model = create_embedding_model();
    let issue = "This is the first React Github issue";
    let embeddings = embed_issue(issue, model);
    let formatted_embeddings = format_embeddings(embeddings);

    println!("{}", formatted_embeddings);
}

#[test]
fn test_embed_query() {
    let model = create_embedding_model();
    let query = "How do I start react-tools?";
    let embeddings = embed_query(query, model);

    println!("{}", embeddings);
}
