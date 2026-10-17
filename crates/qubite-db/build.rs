// Миграции встраиваются в бинарник макросом `sqlx::migrate!`. Без этой строки
// Cargo не пересобирает crate при добавлении нового файла миграции.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
