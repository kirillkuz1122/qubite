//! Встраивает программу английского (`content/english`) в бинарник: сервер
//! один файл, папка с уроками рядом не нужна (D-481).

use std::{env, fs, path::Path};

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../content/english");
    let root = root.canonicalize().expect("нет папки content/english");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut files = vec![root.join("course.json"), root.join("placement.json")];
    let lessons = root.join("lessons");
    println!("cargo:rerun-if-changed={}", lessons.display());
    let mut levels: Vec<_> = fs::read_dir(&lessons)
        .expect("нет lessons")
        .map(|e| e.expect("папка уровня").path())
        .filter(|p| p.is_dir())
        .collect();
    levels.sort();
    for level in levels {
        println!("cargo:rerun-if-changed={}", level.display());
        let mut list: Vec<_> = fs::read_dir(&level)
            .expect("уровень")
            .map(|e| e.expect("урок").path())
            .filter(|p| p.extension().is_some_and(|x| x == "json"))
            .collect();
        list.sort();
        files.extend(list);
    }
    let mut out = String::from(
        "/// Файлы программы: путь от `content/english` и текст.\npub static FILES: &[(&str, &str)] = &[\n",
    );
    for file in files {
        println!("cargo:rerun-if-changed={}", file.display());
        let rel = file.strip_prefix(&root).expect("внутри content/english");
        out.push_str(&format!(
            "    ({:?}, include_str!({:?})),\n",
            rel.to_string_lossy().replace('\\', "/"),
            file.display().to_string()
        ));
    }
    out.push_str("];\n");
    let dest = Path::new(&env::var("OUT_DIR").expect("OUT_DIR")).join("content.rs");
    fs::write(dest, out).expect("content.rs");
}
