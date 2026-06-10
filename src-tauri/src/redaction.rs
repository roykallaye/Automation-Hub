pub(crate) fn redact_line(line: &str) -> String {
    line.split_whitespace()
        .map(|part| {
            if looks_like_email(part) {
                "[redacted-email]".to_string()
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn looks_like_email(value: &str) -> bool {
    let trimmed = value.trim_matches(|character: char| {
        matches!(
            character,
            ',' | ';' | ':' | '"' | '\'' | '(' | ')' | '[' | ']' | '<' | '>'
        )
    });
    trimmed.contains('@') && trimmed.contains('.') && trimmed.len() >= 5
}
