//! A tiny self-contained PRNG so we don't need an external crate (`rand`).
//!
//! This is `xorshift64*` — fast, good enough for generating placeholder
//! detection rankings. It is NOT cryptographically secure.

pub struct Rng {
    state: u64,
}

impl Rng {
    /// Create a new generator. The seed must never be zero, so we force a bit.
    pub fn new(seed: u64) -> Self {
        Self {
            state: seed | 0xA5A5_A5A5_0000_0001,
        }
    }

    /// Seed from the current wall-clock time, giving fresh values per call.
    pub fn from_time() -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x1234_5678_9abc_def0);
        Self::new(nanos)
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform f32 in `[0, 1)`.
    pub fn next_f32(&mut self) -> f32 {
        // Use the top 24 bits for full f32 mantissa precision.
        (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32
    }

    /// Uniform integer in `[0, n)`.
    pub fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }
}
