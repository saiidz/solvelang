"use client";

export default function SubscribeButton() {
  const handleSubscribe = async () => {
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
    });

    const data = await res.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      alert("Could not start checkout");
    }
  };

  return (
    <button
      onClick={handleSubscribe}
      className="rounded-xl bg-black px-6 py-3 text-white"
    >
      Subscribe
    </button>
  );
}
