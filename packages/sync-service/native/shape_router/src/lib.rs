use rustler::{Encoder, Env, NifResult, Term};
use std::sync::RwLock;

mod presence_filter;
mod shape_index;
mod predicate;
mod varint;
mod metrics;

use presence_filter::PresenceFilter;
use shape_index::{ShapeIndex, DeltaOverlay};
use predicate::{PredicateVM, CompiledPredicate};

// Per-(tenant, table) router instance
pub struct ShapeRouter {
    // Fast negative path: if PK not in filter, no shapes match
    presence: RwLock<PresenceFilter>,

    // Exact membership: MPHF + shape-id pool + delta overlay
    index: RwLock<ShapeIndex>,

    // Predicate evaluator
    predicates: RwLock<Vec<CompiledPredicate>>,

    // Metrics for observability
    metrics: metrics::RouterMetrics,
}

impl ShapeRouter {
    fn new() -> Self {
        Self {
            presence: RwLock::new(PresenceFilter::empty()),
            index: RwLock::new(ShapeIndex::new()),
            predicates: RwLock::new(Vec::new()),
            metrics: metrics::RouterMetrics::new(),
        }
    }

    /// Fast path: check if any shapes might match this PK
    fn check_presence(&self, pk_hash: u64) -> bool {
        let start = std::time::Instant::now();
        let filter = self.presence.read().unwrap();
        let result = filter.contains(pk_hash);
        self.metrics.record_presence_check(start.elapsed(), result);
        result
    }

    /// Main routing: find all shapes matching this WAL operation
    fn route_operation(
        &self,
        pk_hash: u64,
        old_row: Option<&[u8]>,
        new_row: Option<&[u8]>,
        changed_columns: &[u16],
    ) -> Vec<u32> {
        let start = std::time::Instant::now();

        // Stage 1: Presence filter (fast negative path)
        if !self.check_presence(pk_hash) {
            self.metrics.record_route_miss(start.elapsed());
            return Vec::new();
        }

        // Stage 2: Get candidate shape IDs from index
        let index = self.index.read().unwrap();
        let candidate_shapes = match index.lookup(pk_hash) {
            Some(shapes) => shapes,
            None => {
                self.metrics.record_false_positive(start.elapsed());
                return Vec::new();
            }
        };

        // Stage 3: Predicate gate - filter by actual WHERE clauses
        let predicates = self.predicates.read().unwrap();
        let mut matched_shapes = Vec::with_capacity(candidate_shapes.len());

        for &shape_id in &candidate_shapes {
            if let Some(predicate) = predicates.get(shape_id as usize) {
                // Quick column mask check: skip if no referenced columns changed
                if !changed_columns.is_empty() && !predicate.columns_intersect(changed_columns) {
                    continue;
                }

                // Full predicate evaluation
                if predicate.evaluate(old_row, new_row) {
                    matched_shapes.push(shape_id);
                }
            }
        }

        self.metrics.record_route_hit(start.elapsed(), matched_shapes.len());
        matched_shapes
    }

    /// Add a new shape to the router
    fn add_shape(&self, shape_id: u32, predicate: CompiledPredicate, pks: Vec<u64>) {
        let mut index = self.index.write().unwrap();
        let mut predicates = self.predicates.write().unwrap();

        // Add to predicate list
        if shape_id as usize >= predicates.len() {
            predicates.resize(shape_id as usize + 1, CompiledPredicate::default());
        }
        predicates[shape_id as usize] = predicate;

        // Add PKs to index (via delta overlay initially)
        for pk_hash in pks {
            index.add_to_delta(pk_hash, shape_id);
        }

        // Mark presence
        // Note: Presence filter rebuild happens separately for efficiency
    }

    /// Remove a shape from the router
    fn remove_shape(&self, shape_id: u32) {
        let mut index = self.index.write().unwrap();
        index.mark_shape_deleted(shape_id);
    }

    /// Rebuild the base structures (run asynchronously)
    fn rebuild(&self) {
        let start = std::time::Instant::now();

        let index = self.index.read().unwrap();
        let all_pks = index.collect_all_present_keys();
        drop(index);

        // Build new presence filter
        let new_presence = PresenceFilter::build(&all_pks);

        // Build new base MPHF + pool (simplified for prototype)
        let index = self.index.write().unwrap();
        // In production: build new ShapeIndex with MPHF, serialize to disk, atomic swap

        // Swap in new filter
        let mut presence = self.presence.write().unwrap();
        *presence = new_presence;

        self.metrics.record_rebuild(start.elapsed(), all_pks.len());
    }
}

// NIF interface

rustler::init!("Elixir.Electric.ShapeRouter.Native");

#[rustler::nif(schedule = "DirtyCpu")]
fn new_router() -> NifResult<ResourceArc<ShapeRouter>> {
    Ok(ResourceArc::new(ShapeRouter::new()))
}

#[rustler::nif]
fn route(
    router: ResourceArc<ShapeRouter>,
    pk_hash: u64,
    old_row: Option<Vec<u8>>,
    new_row: Option<Vec<u8>>,
    changed_columns: Vec<u16>,
) -> Vec<u32> {
    router.route_operation(
        pk_hash,
        old_row.as_deref(),
        new_row.as_deref(),
        &changed_columns,
    )
}

#[rustler::nif]
fn add_shape(
    router: ResourceArc<ShapeRouter>,
    shape_id: u32,
    predicate_bytes: Vec<u8>,
    pk_hashes: Vec<u64>,
) -> NifResult<bool> {
    let predicate = CompiledPredicate::deserialize(&predicate_bytes)
        .map_err(|e| rustler::Error::Term(Box::new(format!("Invalid predicate: {}", e))))?;

    router.add_shape(shape_id, predicate, pk_hashes);
    Ok(true)
}

#[rustler::nif]
fn remove_shape(router: ResourceArc<ShapeRouter>, shape_id: u32) -> bool {
    router.remove_shape(shape_id);
    true
}

#[rustler::nif(schedule = "DirtyCpu")]
fn rebuild(router: ResourceArc<ShapeRouter>) -> bool {
    router.rebuild();
    true
}

#[rustler::nif]
fn get_metrics(router: ResourceArc<ShapeRouter>) -> String {
    serde_json::to_string(&router.metrics).unwrap_or_default()
}

// Resource definition for Elixir
pub struct ResourceArc<T>(std::sync::Arc<T>);

impl<T> ResourceArc<T> {
    fn new(data: T) -> Self {
        ResourceArc(std::sync::Arc::new(data))
    }
}

impl<T> std::ops::Deref for ResourceArc<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T: Send + Sync> Encoder for ResourceArc<T> {
    fn encode<'a>(&self, env: Env<'a>) -> Term<'a> {
        rustler::resource::ResourceArc::new(self.0.clone()).encode(env)
    }
}

fn load(env: Env, _: Term) -> bool {
    rustler::resource!(ShapeRouter, env);
    true
}
