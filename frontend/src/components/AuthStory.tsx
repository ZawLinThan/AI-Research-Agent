import { BookOpen, FlaskConical, Sparkles } from "lucide-react";
import type { MouseEvent } from "react";

export const AuthStory = ({
  link,
}: {
  link: (event: MouseEvent<HTMLAnchorElement>, to: string) => void;
}) => (
  <aside className="auth-story">
    <a className="brand" href="/" onClick={(e) => link(e, "/")}>
      <span className="brand-mark">
        <FlaskConical size={21} />
      </span>
      fieldwork<span className="brand-dot">.</span>
    </a>
    <div className="story-content">
      <span className="auth-kicker">
        <span /> A WORKSPACE FOR DISCOVERY
      </span>
      <h1>
        Follow your
        <br />
        curiosity.
        <br />
        <em>Find your clarity.</em>
      </h1>
      <p>
        Give your questions room to grow.
        <br />
        Bring your research into focus.
      </p>
      <div className="discovery-art" aria-hidden="true">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="orbit orbit-three" />
        <div className="orbit-center">
          <Sparkles size={32} strokeWidth={1.2} />
        </div>
        <span className="orbit-point point-one" />
        <span className="orbit-point point-two" />
        <span className="art-caption caption-one">A QUESTION</span>
        <span className="art-caption caption-two">A NEW PERSPECTIVE</span>
      </div>
    </div>
    <div className="story-foot">
      <BookOpen size={16} />
      <span>Good questions are just the beginning.</span>
      <span className="edition">FIELD NOTES / 01</span>
    </div>
  </aside>
);
