use ollama_rs::{
    generation::completion::request::GenerationRequest,
    Ollama,
};

/// Create embeddings for a github issue
pub async fn basic() {
    // By default it will connect to localhost:11434
    let mut llama = start_ollama();
    let response = chat(&mut llama, "Why is the sky blue?".to_string(), "".to_string()).await;

    eprintln!("{}", response);
}

pub fn start_ollama() -> Ollama {
    Ollama::default()
}

pub async fn chat(llama: &mut Ollama, question: String, context: String) -> String {
    let model = "llama2:latest".to_string();
    let mut prompt = question.to_string();
    if !context.is_empty() {
        prompt.push_str("\n\nAnswer based on this context: ");
        prompt.push_str(&context);
    }

    let res = llama
        .generate(GenerationRequest::new(model, prompt))
        .await
        .unwrap();

    res.response
}
