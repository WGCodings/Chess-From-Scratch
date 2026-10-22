//! ---
//! id: cutoff_table
//! label: Cutoff table
//! slot: ordering
//! requires: alpha_beta
//! description: Orders quiet moves by how often the same from-to move caused a cutoff.
//! info: A small history-like table indexed by the move's from and to squares. Every quiet move that causes a beta cutoff earns depth squared points; quiet moves with more points are tried first. It shows how one block can add a field to the Searcher, clear it, update it on cutoffs and use it in move ordering.
//! params:
//!   CUTOFF_TABLE_MAX: i32 = 70000 (1..79999) "Highest order score"
//! ---

// @hook searcher_fields
// Cutoff points per (from, to) square pair.
cutoff_table: Box<[[i32; 64]; 64]>,

// @hook searcher_init
cutoff_table: Box::new([[0; 64]; 64]),

// @hook new_game
*self.cutoff_table = [[0; 64]; 64];

// @hook ordering
// Quiet moves that caused cutoffs before go first, below captures and killers.
if order == 0 && !is_capture(&board, mv) {
    order = self.cutoff_table[mv.from as usize][mv.to as usize].min(CUTOFF_TABLE_MAX);
}

// @hook on_cutoff
// Reward the quiet move that caused the cutoff.
if quiet {
    let entry = &mut self.cutoff_table[mv.from as usize][mv.to as usize];
    *entry = (*entry + depth * depth).min(1 << 20);
}
