type Props = {
  title: string;
  description?: string;
};

export function SectionHeader({ title, description }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h1>
      {description ? (
        <p className="text-[11.5px] text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
