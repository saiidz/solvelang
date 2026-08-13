#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceOrigin {
    pub filename: String,
    pub line: usize,
    pub source_line: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SourceMap {
    origins: Vec<SourceOrigin>,
}

impl SourceMap {
    pub fn new(origins: Vec<SourceOrigin>) -> Self {
        Self { origins }
    }

    pub fn identity(source: &str, filename: &str) -> Self {
        Self {
            origins: source
                .lines()
                .enumerate()
                .map(|(index, source_line)| SourceOrigin {
                    filename: filename.to_string(),
                    line: index + 1,
                    source_line: source_line.to_string(),
                })
                .collect(),
        }
    }

    pub fn origin(&self, flattened_line: usize) -> Option<&SourceOrigin> {
        self.origins.get(flattened_line.checked_sub(1)?)
    }

    pub fn len(&self) -> usize {
        self.origins.len()
    }

    pub fn is_empty(&self) -> bool {
        self.origins.is_empty()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LoadedSource {
    pub content: String,
    pub source_map: SourceMap,
}

impl LoadedSource {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push_line(&mut self, filename: &str, line: usize, source_line: &str) {
        self.content.push_str(source_line);
        self.content.push('\n');
        self.source_map.origins.push(SourceOrigin {
            filename: filename.to_string(),
            line,
            source_line: source_line.to_string(),
        });
    }

    pub fn append(&mut self, other: LoadedSource) {
        self.content.push_str(&other.content);
        self.source_map.origins.extend(other.source_map.origins);
    }
}

#[cfg(test)]
mod tests {
    use super::{LoadedSource, SourceMap};

    #[test]
    fn identity_maps_each_flattened_line_to_the_same_source_line() {
        let map = SourceMap::identity("first\nsecond\n", "main.solve");
        let origin = map.origin(2).expect("line two should exist");
        assert_eq!(origin.filename, "main.solve");
        assert_eq!(origin.line, 2);
        assert_eq!(origin.source_line, "second");
    }

    #[test]
    fn loaded_source_preserves_origins_when_appended() {
        let mut main = LoadedSource::new();
        main.push_line("main.solve", 1, "let before = 1");
        let mut imported = LoadedSource::new();
        imported.push_line("lib/math.solve", 7, "print(missing)");
        main.append(imported);

        assert_eq!(main.content, "let before = 1\nprint(missing)\n");
        let origin = main.source_map.origin(2).expect("imported line should exist");
        assert_eq!(origin.filename, "lib/math.solve");
        assert_eq!(origin.line, 7);
        assert_eq!(origin.source_line, "print(missing)");
    }
}
